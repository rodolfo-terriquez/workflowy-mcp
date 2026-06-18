import { createHash, timingSafeEqual } from "crypto";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";

export const runtime = "nodejs";

const WORKFLOWY_API_BASE = "https://workflowy.com";
const LLM_DOC_API_BASE = "https://beta.workflowy.com";
const AI_INSTRUCTIONS_BOOKMARK = "ai_instructions";
const LINE_TYPES = [
  "todo",
  "h1",
  "h2",
  "h3",
  "p",
  "bullets",
  "code",
  "quote",
  "table",
] as const;
const EXPORT_RATE_LIMIT_MS = 60 * 1000;
const STALE_SYNC_LOCK_MS = 5 * 60 * 1000;
const CACHE_STALE_MS = 60 * 60 * 1000;
const INSERT_CHUNK_SIZE = 500;

type SqlClient = NeonQueryFunction<false, false>;
type ToolResponse = { content: Array<{ type: "text"; text: string }> };

interface WorkflowyExportNode {
  id: string;
  name?: string;
  note?: string;
  parent_id?: string;
  completed?: boolean;
  completedAt?: number | null;
  priority?: number;
  createdAt?: number;
  modifiedAt?: number;
}

interface WorkflowyExportResponse {
  nodes: WorkflowyExportNode[];
}

interface CachedNodeRow {
  id: string;
  name: string;
  note: string | null;
  parent_id: string | null;
  completed: boolean;
  children_count: number;
  priority: number;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  relevance_score?: number;
}

let dbPromise: Promise<SqlClient> | undefined;

async function getDb(): Promise<SqlClient> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set in process.env");
    }

    const sql = neon(databaseUrl);
    await sql`
      CREATE TABLE IF NOT EXISTS workflowy_bookmarks (
        account_key TEXT NOT NULL,
        name TEXT NOT NULL,
        node_id TEXT NOT NULL,
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (account_key, name)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS workflowy_nodes (
        account_key TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        note TEXT,
        parent_id TEXT,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        children_count INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        PRIMARY KEY (account_key, id)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS workflowy_sync_meta (
        account_key TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (account_key, key)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_workflowy_nodes_parent
      ON workflowy_nodes (account_key, parent_id, priority)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_workflowy_nodes_completed
      ON workflowy_nodes (account_key, completed)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_workflowy_nodes_search
      ON workflowy_nodes
      USING GIN (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(note, '')))
    `;

    return sql;
  })();

  return dbPromise;
}

function jsonContent(value: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function textContent(text: string): ToolResponse {
  return { content: [{ type: "text", text }] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getApiKey(extra: { authInfo?: AuthInfo }): string {
  if (!extra.authInfo?.token) {
    throw new Error("Workflowy API key not provided in Authorization header");
  }
  return extra.authInfo.token;
}

function accountKeyFromApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function normalizeNodeId(value: string): string {
  const trimmed = value.trim();
  const linkMatch = trimmed.match(/#\/([0-9a-f]{12})(?:\b|$)/i);
  return linkMatch?.[1] ?? trimmed;
}

function clampDepth(depth: number | undefined): number {
  if (!Number.isFinite(depth)) {
    return 3;
  }
  return Math.min(Math.max(Math.trunc(depth ?? 3), 1), 10);
}

async function workflowyJsonRequest(
  apiKey: string,
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { ok: res.ok, status: res.status, data };
}

function toIsoFromWorkflowyTimestamp(value: number | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 12);
}

async function getSyncMeta(
  sql: SqlClient,
  accountKey: string,
  key: string,
): Promise<string | null> {
  const rows = await sql`
    SELECT value
    FROM workflowy_sync_meta
    WHERE account_key = ${accountKey} AND key = ${key}
  `;
  return typeof rows[0]?.value === "string" ? rows[0].value : null;
}

function syncMetaQuery(
  sql: SqlClient,
  accountKey: string,
  key: string,
  value: string,
) {
  return sql`
    INSERT INTO workflowy_sync_meta (account_key, key, value, updated_at)
    VALUES (${accountKey}, ${key}, ${value}, NOW())
    ON CONFLICT (account_key, key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

async function setSyncMeta(
  sql: SqlClient,
  accountKey: string,
  key: string,
  value: string,
): Promise<void> {
  await syncMetaQuery(sql, accountKey, key, value);
}

async function getCacheStatus(sql: SqlClient, accountKey: string) {
  const [countRows, lastSync, syncInProgress] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS count
      FROM workflowy_nodes
      WHERE account_key = ${accountKey}
    `,
    getSyncMeta(sql, accountKey, "last_full_sync"),
    getSyncMeta(sql, accountKey, "sync_in_progress"),
  ]);

  const nodeCount = Number(countRows[0]?.count ?? 0);
  const lastSyncedAt = lastSync ?? "never";
  const lastSyncTime = lastSync ? new Date(lastSync).getTime() : 0;
  const cacheIsStale = !lastSyncTime || Date.now() - lastSyncTime > CACHE_STALE_MS;

  return {
    node_count: nodeCount,
    last_synced_at: lastSyncedAt,
    is_stale: cacheIsStale,
    sync_in_progress: syncInProgress === "true",
  };
}

async function fetchNodesExport(apiKey: string): Promise<WorkflowyExportResponse> {
  const result = await workflowyJsonRequest(
    apiKey,
    `${WORKFLOWY_API_BASE}/api/v1/nodes-export`,
    { method: "GET" },
  );

  if (!result.ok) {
    throw new Error(`Workflowy export failed with HTTP ${result.status}`);
  }

  if (!isRecord(result.data) || !Array.isArray(result.data.nodes)) {
    return { nodes: [] };
  }

  return { nodes: result.data.nodes as WorkflowyExportNode[] };
}

function serializeNodesForCache(nodes: WorkflowyExportNode[]) {
  const childrenCountMap = new Map<string, number>();
  for (const node of nodes) {
    if (node.parent_id) {
      childrenCountMap.set(
        node.parent_id,
        (childrenCountMap.get(node.parent_id) ?? 0) + 1,
      );
    }
  }

  return nodes
    .filter((node) => typeof node.id === "string" && node.id.trim())
    .map((node) => ({
      id: node.id,
      name: node.name ?? "",
      note: node.note ?? null,
      parent_id: node.parent_id ?? null,
      completed: Boolean(node.completed),
      children_count: childrenCountMap.get(node.id) ?? 0,
      priority: node.priority ?? 0,
      created_at: toIsoFromWorkflowyTimestamp(node.createdAt),
      updated_at: toIsoFromWorkflowyTimestamp(node.modifiedAt),
      completed_at: toIsoFromWorkflowyTimestamp(node.completedAt),
    }));
}

async function replaceNodesCache(
  sql: SqlClient,
  accountKey: string,
  nodes: WorkflowyExportNode[],
  syncedAt: string,
): Promise<void> {
  const serializedNodes = serializeNodesForCache(nodes);
  const queries = [
    sql`DELETE FROM workflowy_nodes WHERE account_key = ${accountKey}`,
  ];

  for (let index = 0; index < serializedNodes.length; index += INSERT_CHUNK_SIZE) {
    const chunk = serializedNodes.slice(index, index + INSERT_CHUNK_SIZE);
    queries.push(
      sql(
        `
          INSERT INTO workflowy_nodes (
            account_key,
            id,
            name,
            note,
            parent_id,
            completed,
            children_count,
            priority,
            created_at,
            updated_at,
            completed_at
          )
          SELECT
            $1,
            id,
            name,
            note,
            parent_id,
            completed,
            children_count,
            priority,
            created_at,
            updated_at,
            completed_at
          FROM jsonb_to_recordset($2::jsonb) AS node(
            id TEXT,
            name TEXT,
            note TEXT,
            parent_id TEXT,
            completed BOOLEAN,
            children_count INTEGER,
            priority INTEGER,
            created_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
          )
        `,
        [accountKey, JSON.stringify(chunk)],
      ),
    );
  }

  queries.push(
    syncMetaQuery(sql, accountKey, "last_full_sync", syncedAt),
    syncMetaQuery(sql, accountKey, "last_sync_node_count", String(serializedNodes.length)),
    syncMetaQuery(sql, accountKey, "sync_in_progress", "false"),
  );

  await sql.transaction(queries);
}

async function performFullSync(apiKey: string, accountKey: string): Promise<{
  success: boolean;
  nodes_synced?: number;
  synced_at?: string;
  cache_status?: Awaited<ReturnType<typeof getCacheStatus>>;
  error?: string;
}> {
  const sql = await getDb();
  const lastExportCalledAt = await getSyncMeta(sql, accountKey, "last_export_called_at");
  if (lastExportCalledAt) {
    const elapsedMs = Date.now() - new Date(lastExportCalledAt).getTime();
    if (elapsedMs < EXPORT_RATE_LIMIT_MS) {
      return {
        success: false,
        error: `Rate limited. Please wait ${Math.ceil(
          (EXPORT_RATE_LIMIT_MS - elapsedMs) / 1000,
        )} seconds.`,
        cache_status: await getCacheStatus(sql, accountKey),
      };
    }
  }

  const inProgress = await getSyncMeta(sql, accountKey, "sync_in_progress");
  const syncStartedAt = await getSyncMeta(sql, accountKey, "sync_started_at");
  if (inProgress === "true" && syncStartedAt) {
    const elapsedMs = Date.now() - new Date(syncStartedAt).getTime();
    if (elapsedMs < STALE_SYNC_LOCK_MS) {
      return {
        success: false,
        error: "Sync already in progress.",
        cache_status: await getCacheStatus(sql, accountKey),
      };
    }
  }

  const startedAt = new Date().toISOString();
  await setSyncMeta(sql, accountKey, "sync_in_progress", "true");
  await setSyncMeta(sql, accountKey, "sync_started_at", startedAt);
  await setSyncMeta(sql, accountKey, "last_export_called_at", startedAt);

  try {
    const exportData = await fetchNodesExport(apiKey);
    const syncedAt = new Date().toISOString();
    await replaceNodesCache(sql, accountKey, exportData.nodes, syncedAt);

    return {
      success: true,
      nodes_synced: exportData.nodes.length,
      synced_at: syncedAt,
      cache_status: await getCacheStatus(sql, accountKey),
    };
  } catch (error) {
    await setSyncMeta(sql, accountKey, "sync_in_progress", "false");
    await setSyncMeta(sql, accountKey, "last_sync_error", errorMessage(error));
    return {
      success: false,
      error: errorMessage(error),
      cache_status: await getCacheStatus(sql, accountKey),
    };
  }
}

async function buildNodePath(
  sql: SqlClient,
  accountKey: string,
  nodeId: string,
): Promise<string[]> {
  const rows = await sql`
    WITH RECURSIVE path AS (
      SELECT id, name, parent_id, 0 AS depth
      FROM workflowy_nodes
      WHERE account_key = ${accountKey} AND id = ${nodeId}

      UNION ALL

      SELECT parent.id, parent.name, parent.parent_id, path.depth + 1
      FROM workflowy_nodes parent
      JOIN path ON path.parent_id = parent.id
      WHERE parent.account_key = ${accountKey} AND path.depth < 20
    )
    SELECT name
    FROM path
    ORDER BY depth DESC
  `;

  return rows
    .map((row) => String(row.name ?? ""))
    .filter(Boolean);
}

function formatPathString(path: string[]): string {
  return path.length > 0 ? path.join(" > ") : "";
}

async function getChildrenPreview(
  sql: SqlClient,
  accountKey: string,
  parentId: string,
) {
  const rows = await sql`
    SELECT name, children_count
    FROM workflowy_nodes
    WHERE account_key = ${accountKey} AND parent_id = ${parentId}
    ORDER BY priority
    LIMIT 5
  `;

  return rows.map((row) => ({
    name: String(row.name ?? ""),
    children_count: Number(row.children_count ?? 0),
  }));
}

async function formatSearchResults(
  sql: SqlClient,
  accountKey: string,
  rows: CachedNodeRow[],
) {
  return Promise.all(
    rows.map(async (row) => {
      const path = await buildNodePath(sql, accountKey, row.id);
      const childrenPreview =
        row.children_count > 0
          ? await getChildrenPreview(sql, accountKey, row.id)
          : [];

      return {
        id: row.id,
        name: row.name,
        note: row.note || null,
        parent_id: row.parent_id || null,
        completed: Boolean(row.completed),
        children_count: Number(row.children_count ?? 0),
        children_preview: childrenPreview,
        path,
        path_display: formatPathString(path),
        relevance_score:
          typeof row.relevance_score === "number"
            ? Math.round(row.relevance_score * 100) / 100
            : null,
        created_at: row.created_at || null,
        modified_at: row.updated_at || null,
        completed_at: row.completed_at || null,
      };
    }),
  );
}

async function searchCachedNodes({
  accountKey,
  query,
  includeCompleted,
  limit,
}: {
  accountKey: string;
  query: string;
  includeCompleted: boolean;
  limit: number;
}) {
  const sql = await getDb();
  const cacheStatus = await getCacheStatus(sql, accountKey);
  if (cacheStatus.node_count === 0) {
    return {
      error: "Cache is empty. Run sync_nodes first.",
      cache_status: cacheStatus,
      results: [],
    };
  }

  const normalizedQuery = query.trim();
  const queryWords = tokenizeQuery(normalizedQuery);
  if (!normalizedQuery || queryWords.length === 0) {
    return {
      error: "query must contain at least one searchable word",
      cache_status: cacheStatus,
      results: [],
    };
  }

  const rows = (await sql`
    WITH search_query AS (
      SELECT websearch_to_tsquery('simple', ${normalizedQuery}) AS query
    )
    SELECT
      id,
      name,
      note,
      parent_id,
      completed,
      children_count,
      priority,
      created_at,
      updated_at,
      completed_at,
      ts_rank_cd(
        to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(note, '')),
        search_query.query
      ) AS relevance_score
    FROM workflowy_nodes, search_query
    WHERE account_key = ${accountKey}
      AND (${includeCompleted} OR completed = FALSE)
      AND to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(note, ''))
        @@ search_query.query
    ORDER BY relevance_score DESC, updated_at DESC NULLS LAST, priority ASC
    LIMIT ${limit}
  `) as CachedNodeRow[];

  return {
    cache_status: cacheStatus,
    results: await formatSearchResults(sql, accountKey, rows),
  };
}

async function llmDocRead(
  apiKey: string,
  nodeId: string,
  depth?: number,
): Promise<ToolResponse> {
  try {
    const safeDepth = clampDepth(depth);
    const normalizedNodeId = normalizeNodeId(nodeId);
    const url = `${LLM_DOC_API_BASE}/api/llm/doc/read/${encodeURIComponent(
      normalizedNodeId,
    )}/?depth=${safeDepth}`;
    const result = await workflowyJsonRequest(apiKey, url, { method: "GET" });

    if (!result.ok) {
      return jsonContent({
        error: true,
        http_status: result.status,
        message: result.data,
      });
    }

    return jsonContent(result.data);
  } catch (error) {
    return jsonContent({ error: true, message: errorMessage(error) });
  }
}

const docItemSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      n: z.string().describe("Node text/name"),
      d: z.string().optional().describe("Node note/description"),
      l: z.enum(LINE_TYPES).optional().describe("Workflowy line type"),
      x: z.number().optional().describe("Completion status: 1 or 0"),
      c: z.array(docItemSchema).optional().describe("Nested child nodes"),
    })
    .passthrough(),
);

const operationSchema = z
  .object({
    op: z.enum(["insert", "update", "delete", "move"]),
    under: z
      .string()
      .optional()
      .describe("For insert/move: parent tag or target"),
    after: z
      .string()
      .optional()
      .describe("For insert: sibling tag to insert after"),
    items: z.array(docItemSchema).optional().describe("For insert: nodes"),
    position: z.enum(["top", "bottom"]).optional(),
    ref: z.string().optional().describe("For update/delete/move: node tag"),
    to: z
      .object({
        n: z.string().optional().describe("New node text/name"),
        d: z.string().optional().describe("New node note/description"),
        l: z.enum(LINE_TYPES).optional().describe("New line type"),
        x: z.number().optional().describe("New completion status: 1 or 0"),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type LlmDocOperation = z.infer<typeof operationSchema>;

function validateOperations(operations: LlmDocOperation[]): string | null {
  if (!Array.isArray(operations) || operations.length === 0) {
    return "operations must be a non-empty array";
  }

  for (const [index, operation] of operations.entries()) {
    const label = `operations[${index}]`;
    if (operation.op === "insert") {
      const hasUnder = Boolean(operation.under);
      const hasAfter = Boolean(operation.after);
      if (hasUnder === hasAfter) {
        return `${label}: insert requires exactly one of under or after`;
      }
      if (!operation.items?.length) {
        return `${label}: insert requires at least one item`;
      }
    }

    if (operation.op === "update") {
      if (!operation.ref) {
        return `${label}: update requires ref`;
      }
      if (!operation.to || Object.keys(operation.to).length === 0) {
        return `${label}: update requires a non-empty to object`;
      }
    }

    if (operation.op === "delete" && !operation.ref) {
      return `${label}: delete requires ref`;
    }

    if (operation.op === "move") {
      if (!operation.ref) {
        return `${label}: move requires ref`;
      }
      if (!operation.under) {
        return `${label}: move requires under`;
      }
    }
  }

  return null;
}

async function llmDocEdit(
  apiKey: string,
  root: string,
  operations: LlmDocOperation[],
): Promise<ToolResponse> {
  const validationError = validateOperations(operations);
  if (validationError) {
    return jsonContent({ error: true, message: validationError });
  }

  const body = {
    root: normalizeNodeId(root),
    operations,
  };

  try {
    const result = await workflowyJsonRequest(
      apiKey,
      `${LLM_DOC_API_BASE}/api/llm/doc/edit`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    if (!result.ok) {
      return jsonContent({
        error: true,
        http_status: result.status,
        message: result.data,
        request: body,
      });
    }

    return jsonContent({ success: true, response: result.data });
  } catch (error) {
    return jsonContent({ error: true, message: errorMessage(error), request: body });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NODE_META_KEYS = new Set([
  "ancestors",
  "c",
  "d",
  "l",
  "m",
  "x",
  "+",
]);

function nodeTitle(node: Record<string, unknown>): string {
  for (const [key, value] of Object.entries(node)) {
    if (!NODE_META_KEYS.has(key) && typeof value === "string") {
      return value;
    }
  }
  return "";
}

function docToOutline(value: unknown, depth = 0): string {
  if (!isRecord(value)) {
    return "";
  }

  const indent = "  ".repeat(depth);
  const title = nodeTitle(value);
  const note = typeof value.d === "string" ? value.d : "";
  const lines: string[] = [];

  if (title) {
    lines.push(`${indent}- ${title}${value.x === 1 ? " [completed]" : ""}`);
  }

  if (note) {
    for (const line of note.split(/\r?\n/)) {
      lines.push(`${indent}  ${line}`);
    }
  }

  const children = Array.isArray(value.c) ? value.c : [];
  for (const child of children) {
    const childOutline = docToOutline(child, depth + 1);
    if (childOutline) {
      lines.push(childOutline);
    }
  }

  return lines.join("\n");
}

async function readUserInstructions(
  apiKey: string,
  nodeId: string,
): Promise<string> {
  const result = await workflowyJsonRequest(
    apiKey,
    `${LLM_DOC_API_BASE}/api/llm/doc/read/${encodeURIComponent(
      normalizeNodeId(nodeId),
    )}/?depth=6`,
    { method: "GET" },
  );

  if (!result.ok) {
    return `(Could not read ${AI_INSTRUCTIONS_BOOKMARK}: Workflowy returned ${result.status})`;
  }

  const outline = docToOutline(result.data).trim();
  return outline || `(${AI_INSTRUCTIONS_BOOKMARK} returned no readable text)`;
}

const serverInstructions = `This MCP server connects to a user's Workflowy account from a remote self-hosted deployment.

## Start Here
1. Call list_bookmarks first. It returns saved Workflowy locations and user instructions when configured.
2. Use read_doc for current Workflowy content. Use edit_doc for batched changes.
3. Prefer one read_doc followed by one edit_doc with all needed operations.
4. Use search_nodes when you do not know where something is. If the cache is empty, call sync_nodes first.

## Node IDs
- Use 12-character Workflowy tags, full UUIDs, or special targets: today, tomorrow, next_week, inbox, None.
- If the user shares a Workflowy link, extract the 12-hex ID after #/.

## edit_doc
- insert: use exactly one of under or after, and provide items.
- update: provide ref and to.
- delete: provide ref.
- move: provide ref and under.
- Items use n for text, d for notes, l for line type, x for completion, and c for children.`;

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_bookmarks",
      "List saved Workflowy bookmarks and user instructions. Call this at the start of every conversation.",
      {},
      async (_args, extra) => {
        const apiKey = getApiKey(extra);
        const accountKey = accountKeyFromApiKey(apiKey);
        const sql = await getDb();
        const bookmarks = await sql`
          SELECT name, node_id, context, created_at, updated_at
          FROM workflowy_bookmarks
          WHERE account_key = ${accountKey}
          ORDER BY name
        `;
        const aiInstructionsBookmark = bookmarks.find(
          (bookmark) => bookmark.name === AI_INSTRUCTIONS_BOOKMARK,
        );
        const userInstructions = aiInstructionsBookmark
          ? await readUserInstructions(apiKey, String(aiInstructionsBookmark.node_id))
          : undefined;

        return jsonContent({
          _instructions:
            "READ THIS FIRST: Use user_instructions for this conversation when present. Use bookmark node_ids directly with read_doc.",
          account: {
            id: accountKey.slice(0, 12),
            storage: "remote-neon",
          },
          bookmarks,
          user_instructions: userInstructions,
          action_required: aiInstructionsBookmark
            ? undefined
            : `No ${AI_INSTRUCTIONS_BOOKMARK} bookmark found. If the user has an AI Instructions node, read it and save it with save_bookmark using name "${AI_INSTRUCTIONS_BOOKMARK}".`,
        });
      },
    );

    server.tool(
      "save_bookmark",
      "Save a Workflowy node ID with a friendly name and context notes for future sessions.",
      {
        name: z
          .string()
          .min(1)
          .describe("A friendly name, for example daily_tasks or ai_instructions"),
        node_id: z
          .string()
          .min(1)
          .describe("A Workflowy node tag, UUID, special target, or Workflowy link"),
        context: z
          .string()
          .optional()
          .describe("Notes for future AI sessions about when and how to use this node"),
      },
      async (
        {
          name,
          node_id,
          context,
        }: { name: string; node_id: string; context?: string },
        extra,
      ) => {
        const apiKey = getApiKey(extra);
        const accountKey = accountKeyFromApiKey(apiKey);
        const sql = await getDb();
        const normalizedNodeId = normalizeNodeId(node_id);
        const normalizedContext = context?.trim() || null;

        await sql`
          INSERT INTO workflowy_bookmarks (account_key, name, node_id, context)
          VALUES (${accountKey}, ${name}, ${normalizedNodeId}, ${normalizedContext})
          ON CONFLICT (account_key, name)
          DO UPDATE SET
            node_id = EXCLUDED.node_id,
            context = EXCLUDED.context,
            updated_at = NOW()
        `;

        return textContent(
          `Bookmark "${name}" saved with node ID: ${normalizedNodeId}${
            normalizedContext ? ` and context: "${normalizedContext}"` : ""
          }`,
        );
      },
    );

    server.tool(
      "delete_bookmark",
      "Delete a saved bookmark by name.",
      {
        name: z.string().min(1).describe("The bookmark name to delete"),
      },
      async ({ name }: { name: string }, extra) => {
        const apiKey = getApiKey(extra);
        const accountKey = accountKeyFromApiKey(apiKey);
        const sql = await getDb();
        const deleted = await sql`
          DELETE FROM workflowy_bookmarks
          WHERE account_key = ${accountKey} AND name = ${name}
          RETURNING name
        `;

        if (deleted.length === 0) {
          return textContent(`Bookmark "${name}" not found`);
        }

        return textContent(`Bookmark "${name}" deleted`);
      },
    );

    server.tool(
      "read_doc",
      "Read a Workflowy node and its children using the LLM Doc API. Returns tag-as-key JSON.",
      {
        node_id: z
          .string()
          .min(1)
          .describe(
            "12-hex tag, full UUID, Workflowy link, or special target: today, tomorrow, next_week, inbox, None",
          ),
        depth: z
          .number()
          .optional()
          .describe("How many child levels to include. Default 3, max 10."),
      },
      async (
        { node_id, depth }: { node_id: string; depth?: number },
        extra,
      ) => llmDocRead(getApiKey(extra), node_id, depth),
    );

    server.tool(
      "edit_doc",
      "Edit Workflowy nodes using the LLM Doc API. Supports insert, update, delete, and move in one batched request.",
      {
        root: z
          .string()
          .min(1)
          .describe("Subtree root tag/UUID or target such as today, inbox, or None"),
        operations: z
          .array(operationSchema)
          .min(1)
          .describe("Operations to apply in order"),
      },
      async (
        {
          root,
          operations,
        }: { root: string; operations: LlmDocOperation[] },
        extra,
      ) => llmDocEdit(getApiKey(extra), root, operations),
    );

    server.tool(
      "search_nodes",
      "Search the Neon-backed Workflowy cache by text. Run sync_nodes first if the cache is empty.",
      {
        query: z.string().min(1).describe("Text to search for"),
        include_completed: z
          .boolean()
          .optional()
          .describe("Include completed Workflowy nodes. Defaults to false."),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results. Defaults to 10, max 100."),
      },
      async (
        {
          query,
          include_completed,
          limit,
        }: { query: string; include_completed?: boolean; limit?: number },
        extra,
      ) => {
        const apiKey = getApiKey(extra);
        const accountKey = accountKeyFromApiKey(apiKey);
        const safeLimit = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 100);
        const result = await searchCachedNodes({
          accountKey,
          query,
          includeCompleted: include_completed ?? false,
          limit: safeLimit,
        });

        return jsonContent({
          query,
          results: result.results,
          total_found: result.results.length,
          cache_status: result.cache_status,
          error: result.error,
        });
      },
    );

    server.tool(
      "sync_nodes",
      "Fetch the full Workflowy nodes export and replace the Neon-backed search cache. Rate limited to one export per minute.",
      {},
      async (_args, extra) => {
        const apiKey = getApiKey(extra);
        const accountKey = accountKeyFromApiKey(apiKey);
        return jsonContent(await performFullSync(apiKey, accountKey));
      },
    );

    server.tool(
      "get_targets",
      "Get special Workflowy targets such as inbox and home.",
      {},
      async (_args, extra) => {
        try {
          const result = await workflowyJsonRequest(
            getApiKey(extra),
            `${WORKFLOWY_API_BASE}/api/v1/targets`,
            { method: "GET" },
          );
          return jsonContent({
            http_status: result.status,
            ok: result.ok,
            data: result.data,
          });
        } catch (error) {
          return jsonContent({ error: true, message: errorMessage(error) });
        }
      },
    );
  },
  { instructions: serverInstructions },
  { basePath: "/api" },
);

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) {
    return undefined;
  }

  const accessSecret = process.env.ACCESS_SECRET;
  if (!accessSecret) {
    return undefined;
  }

  const separatorIndex = bearerToken.indexOf(":");
  if (separatorIndex <= 0) {
    return undefined;
  }

  const providedSecret = bearerToken.slice(0, separatorIndex);
  if (!timingSafeStringEqual(providedSecret, accessSecret)) {
    return undefined;
  }

  const workflowyApiKey = bearerToken.slice(separatorIndex + 1).trim();
  if (!workflowyApiKey) {
    return undefined;
  }

  return {
    token: workflowyApiKey,
    scopes: ["workflowy"],
    clientId: accountKeyFromApiKey(workflowyApiKey).slice(0, 12),
  };
};

function originIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  if (!origin || !allowedOrigins?.trim()) {
    return true;
  }

  return allowedOrigins
    .split(",")
    .map((allowedOrigin) => allowedOrigin.trim())
    .filter(Boolean)
    .includes(origin);
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  const allowOrigin = allowedOrigins?.trim() ? origin ?? "null" : origin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
    "Access-Control-Expose-Headers":
      "mcp-session-id, mcp-protocol-version, www-authenticate",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = corsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true });
const runAuthHandler = authHandler as (
  request: Request,
  context?: { params?: { transport?: string } },
) => Response | Promise<Response>;

async function route(
  request: Request,
  context: { params?: { transport?: string } },
): Promise<Response> {
  if (!originIsAllowed(request)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  return withCors(await runAuthHandler(request, context), request);
}

async function options(
  request: Request,
): Promise<Response> {
  if (!originIsAllowed(request)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export { route as DELETE, route as GET, options as OPTIONS, route as POST };
