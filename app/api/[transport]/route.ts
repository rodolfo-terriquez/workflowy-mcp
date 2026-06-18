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

type SqlClient = NeonQueryFunction<false, false>;
type ToolResponse = { content: Array<{ type: "text"; text: string }> };

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

  return runAuthHandler(request, context);
}

export { route as DELETE, route as GET, route as POST };
