import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

// Initialize database and ensure table exists
async function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in process.env");
  }
  const sql = neon(databaseUrl);

  // Create table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS bookmarks (
      name TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  return sql;
}

// Helper function for Workflowy API requests
async function workflowyRequest(
  apiKey: string,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
) {
  const url = `https://workflowy.com${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { http_status: res.status, ok: res.ok, data },
          null,
          2,
        ),
      },
    ],
  };
}

// Helper to get the API key from auth context
function getApiKey(extra: { authInfo?: AuthInfo }): string {
  if (!extra.authInfo?.token) {
    throw new Error("Workflowy API key not provided in Authorization header");
  }
  return extra.authInfo.token;
}

// Validate that the provided token is a valid Workflowy API key
async function validateWorkflowyToken(apiKey: string): Promise<void> {
  const res = await fetch("https://workflowy.com/api/v1/targets", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error("Invalid Workflowy API key");
  }
}

const handler = createMcpHandler(
  (server) => {
    // ==================== BOOKMARK TOOLS ====================

    server.tool(
      "save_bookmark",
      "Save a Workflowy node ID with a friendly name for easy reference later. Check similar bookmarks before creating a new one to avoid duplicates.",
      {
        name: z
          .string()
          .describe(
            "A friendly name for the bookmark (e.g., 'special_inbox', 'work_tasks')",
          ),
        node_id: z.string().describe("The Workflowy node UUID to bookmark"),
      },
      async ({ name, node_id }: { name: string; node_id: string }, extra) => {
        await validateWorkflowyToken(getApiKey(extra));
        const sql = await getDb();
        await sql`
          INSERT INTO bookmarks (name, node_id)
          VALUES (${name}, ${node_id})
          ON CONFLICT (name) DO UPDATE SET node_id = ${node_id}
        `;
        return {
          content: [
            {
              type: "text",
              text: `Bookmark "${name}" saved with node ID: ${node_id}`,
            },
          ],
        };
      },
    );

    server.tool(
      "list_bookmarks",
      "List all saved Workflowy bookmarks. Use this to see what locations have been bookmarked.",
      {},
      async (_args, extra) => {
        await validateWorkflowyToken(getApiKey(extra));
        const sql = await getDb();
        const result =
          await sql`SELECT name, node_id, created_at FROM bookmarks ORDER BY name`;
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    );

    server.tool(
      "delete_bookmark",
      "Delete a saved bookmark by name.",
      {
        name: z.string().describe("The bookmark name to delete"),
      },
      async ({ name }: { name: string }, extra) => {
        await validateWorkflowyToken(getApiKey(extra));
        const sql = await getDb();
        const result =
          await sql`DELETE FROM bookmarks WHERE name = ${name} RETURNING name`;
        if (result.length === 0) {
          return {
            content: [{ type: "text", text: `Bookmark "${name}" not found` }],
          };
        }
        return {
          content: [{ type: "text", text: `Bookmark "${name}" deleted` }],
        };
      },
    );

    // ==================== WORKFLOWY READ TOOLS ====================

    server.tool(
      "list_nodes",
      "List child nodes under a parent. Always use the specified parent_id if you know it. Otherwise, use parent_id='None' for top-level nodes, or use 'inbox'/'home' for those two special locations.",
      {
        parent_id: z
          .string()
          .describe(
            "Parent node ID: 'None' for top-level, 'inbox', 'home', or a node UUID",
          ),
      },
      async ({ parent_id }: { parent_id: string }, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes?parent_id=${encodeURIComponent(parent_id)}`,
          "GET",
        );
      },
    );

    server.tool(
      "get_node",
      "Get a single node by its ID. Returns the node's name, note, and metadata.",
      {
        node_id: z.string().describe("The node UUID to retrieve"),
      },
      async ({ node_id }: { node_id: string }, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}`,
          "GET",
        );
      },
    );

    server.tool(
      "export_all_nodes",
      "Export all nodes from the entire Workflowy account. WARNING: Rate limited to 1 request per minute. Use sparingly.",
      {},
      async (_args, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          "/api/v1/nodes-export",
          "GET",
        );
      },
    );

    server.tool(
      "get_targets",
      "Get special Workflowy targets like 'inbox' and 'home'. Useful for discovering available special locations.",
      {},
      async (_args, extra) => {
        return workflowyRequest(getApiKey(extra), "/api/v1/targets", "GET");
      },
    );

    // ==================== WORKFLOWY WRITE TOOLS ====================

    server.tool(
      "create_node",
      "Create a new node (bullet point) in Workflowy. The node will be added as a child of the specified parent.",
      {
        name: z.string().describe("The text content of the node"),
        parent_id: z
          .string()
          .describe(
            "Where to create the node: 'inbox', 'home', 'None' for top-level, or a node UUID",
          ),
        note: z
          .string()
          .optional()
          .describe("Optional note/description for the node"),
      },
      async (
        {
          name,
          parent_id,
          note,
        }: {
          name: string;
          parent_id: string;
          note?: string;
        },
        extra,
      ) => {
        const body: Record<string, unknown> = { name, parent_id };
        if (note) body.note = note;
        return workflowyRequest(
          getApiKey(extra),
          "/api/v1/nodes",
          "POST",
          body,
        );
      },
    );

    server.tool(
      "update_node",
      "Update an existing node's name or note.",
      {
        node_id: z.string().describe("The node UUID to update"),
        name: z.string().optional().describe("New name/text for the node"),
        note: z.string().optional().describe("New note for the node"),
      },
      async (
        {
          node_id,
          name,
          note,
        }: {
          node_id: string;
          name?: string;
          note?: string;
        },
        extra,
      ) => {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (note !== undefined) body.note = note;
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}`,
          "POST",
          body,
        );
      },
    );

    server.tool(
      "delete_node",
      "Permanently delete a node and all its children. Use with caution.",
      {
        node_id: z.string().describe("The node UUID to delete"),
      },
      async ({ node_id }: { node_id: string }, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}`,
          "DELETE",
        );
      },
    );

    server.tool(
      "move_node",
      "Move a node to a different parent location.",
      {
        node_id: z.string().describe("The node UUID to move"),
        parent_id: z
          .string()
          .describe(
            "New parent: 'inbox', 'home', 'None' for top-level, or a node UUID",
          ),
      },
      async (
        {
          node_id,
          parent_id,
        }: {
          node_id: string;
          parent_id: string;
        },
        extra,
      ) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}/move`,
          "POST",
          {
            parent_id,
          },
        );
      },
    );

    // ==================== WORKFLOWY COMPLETION TOOLS ====================

    server.tool(
      "complete_node",
      "Mark a node as completed (checked off).",
      {
        node_id: z.string().describe("The node UUID to mark as complete"),
      },
      async ({ node_id }: { node_id: string }, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}/complete`,
          "POST",
        );
      },
    );

    server.tool(
      "uncomplete_node",
      "Mark a node as not completed (unchecked).",
      {
        node_id: z.string().describe("The node UUID to mark as incomplete"),
      },
      async ({ node_id }: { node_id: string }, extra) => {
        return workflowyRequest(
          getApiKey(extra),
          `/api/v1/nodes/${node_id}/uncomplete`,
          "POST",
        );
      },
    );
  },
  {
    instructions: `This MCP server connects to a user's Workflowy account. Workflowy is an outliner app where notes are organized as nested bullet points (nodes).

## Key Concepts
- Nodes have a UUID (id), name (text content), and optional note (description)
- Nodes can be nested under other nodes (parent_id)
- Special locations: 'inbox', 'home', or 'None' (top-level)

## Bookmarks
Bookmarks let you save node IDs with friendly names. When a user mentions a named location (like "my work inbox" or "project notes"), use list_bookmarks to see all saved bookmarks and pick the one that best matches what the user is referring to.

## Common Workflows

**Adding content to a bookmarked location:**
1. list_bookmarks to see all saved locations
2. Pick the bookmark that best matches what the user mentioned
3. create_node with that node_id as parent_id

**Exploring the hierarchy:**
1. list_nodes with parent_id='None' to see top-level nodes
2. list_nodes with a specific node_id to see its children

## Tips
- Always use list_bookmarks when the user refers to a named location, then pick the best match
- Avoid export_all_nodes unless necessary (rate limited to 1/min)
- Node names support basic formatting and markdown`,
  },
  {
    basePath: "/api",
  },
);

// Token verification function for withMcpAuth
const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  // The bearer token IS the Workflowy API key
  // We pass it through as the token so tool handlers can access it
  return {
    token: bearerToken,
    scopes: ["workflowy"],
    clientId: "workflowy-user",
  };
};

// Wrap handler with auth - makes authInfo available in tool handlers via extra.authInfo
const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
