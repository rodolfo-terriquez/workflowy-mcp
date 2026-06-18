import { createHash } from "crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SERVER_INSTRUCTIONS,
  DEFAULT_TOOL_DESCRIPTIONS,
  MCP_TOOL_NAMES,
  sanitizeToolDescriptions,
  type McpToolName,
} from "../../../lib/mcp-defaults";
import {
  getWorkflowyApiKey,
  isAdminAuthenticated,
  unauthorizedJson,
} from "../_auth";

export const runtime = "nodejs";

type SqlClient = NeonQueryFunction<false, false>;

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
      CREATE TABLE IF NOT EXISTS workflowy_mcp_settings (
        account_key TEXT PRIMARY KEY,
        server_instructions TEXT,
        tool_descriptions JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    return sql;
  })();

  return dbPromise;
}

function accountKeyFromApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function getAccountKey(): string {
  const apiKey = getWorkflowyApiKey();
  if (!apiKey) {
    throw new Error("WORKFLOWY_API_KEY is not configured.");
  }
  return accountKeyFromApiKey(apiKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeServerInstructions(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_SERVER_INSTRUCTIONS.trim()) {
    return null;
  }

  return trimmed;
}

function sanitizeOverrides(value: unknown): Partial<Record<McpToolName, string>> {
  const descriptions = sanitizeToolDescriptions(isRecord(value) ? value : null);
  const overrides: Partial<Record<McpToolName, string>> = {};

  for (const name of MCP_TOOL_NAMES) {
    const description = descriptions[name];
    if (description && description !== DEFAULT_TOOL_DESCRIPTIONS[name]) {
      overrides[name] = description;
    }
  }

  return overrides;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  try {
    const sql = await getDb();
    const accountKey = getAccountKey();
    const rows = await sql`
      SELECT server_instructions, tool_descriptions, updated_at
      FROM workflowy_mcp_settings
      WHERE account_key = ${accountKey}
    `;
    const row = rows[0];

    return NextResponse.json({
      account_id: accountKey.slice(0, 12),
      server_instructions:
        typeof row?.server_instructions === "string"
          ? row.server_instructions
          : null,
      tool_descriptions: sanitizeToolDescriptions(
        isRecord(row?.tool_descriptions) ? row.tool_descriptions : null,
      ),
      default_server_instructions: DEFAULT_SERVER_INSTRUCTIONS,
      default_tool_descriptions: DEFAULT_TOOL_DESCRIPTIONS,
      tool_names: MCP_TOOL_NAMES,
      updated_at: row?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sql = await getDb();
    const accountKey = getAccountKey();
    const serverInstructions = sanitizeServerInstructions(body.server_instructions);
    const toolDescriptions = sanitizeOverrides(body.tool_descriptions);

    const rows = await sql`
      INSERT INTO workflowy_mcp_settings (
        account_key,
        server_instructions,
        tool_descriptions,
        updated_at
      )
      VALUES (
        ${accountKey},
        ${serverInstructions},
        ${JSON.stringify(toolDescriptions)}::jsonb,
        NOW()
      )
      ON CONFLICT (account_key)
      DO UPDATE SET
        server_instructions = EXCLUDED.server_instructions,
        tool_descriptions = EXCLUDED.tool_descriptions,
        updated_at = NOW()
      RETURNING server_instructions, tool_descriptions, updated_at
    `;
    const row = rows[0];

    return NextResponse.json({
      account_id: accountKey.slice(0, 12),
      server_instructions:
        typeof row?.server_instructions === "string"
          ? row.server_instructions
          : null,
      tool_descriptions: sanitizeToolDescriptions(
        isRecord(row?.tool_descriptions) ? row.tool_descriptions : null,
      ),
      default_server_instructions: DEFAULT_SERVER_INSTRUCTIONS,
      default_tool_descriptions: DEFAULT_TOOL_DESCRIPTIONS,
      tool_names: MCP_TOOL_NAMES,
      updated_at: row?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 400 },
    );
  }
}
