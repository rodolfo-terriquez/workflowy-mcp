import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler((server) => {
  server.tool(
    "workflowy_api",
    {
      path: z
        .string()
        .describe(
          "Workflowy API path starting with /api/, e.g. /api/v1/targets, /api/v1/nodes, /api/v1/nodes/{id}/move, /api/v1/nodes-export",
        ),
      method: z
        .enum(["GET", "POST", "DELETE"])
        .default("GET")
        .describe("HTTP method for the Workflowy API endpoint."),
      query: z
        .record(z.any())
        .optional()
        .describe("Query params for GET, e.g. { parent_id: 'inbox' }."),
      body: z
        .record(z.any())
        .optional()
        .describe("JSON body for POST, e.g. node creation or updates."),
    },
    async ({ path, method, query, body }, { env, logger }) => {
      if (!path.startsWith("/api/")) {
        throw new Error("path must start with /api/");
      }

      const apiKey = env.WORKFLOWY_API_KEY;
      if (!apiKey) {
        throw new Error("WORKFLOWY_API_KEY is not set in Vercel env variables.");
      }

      const qs = new URLSearchParams(
        Object.entries(query || {}).reduce<Record<string, string>>((acc, [k, v]) => {
          if (v !== undefined && v !== null) acc[k] = String(v);
          return acc;
        }, {}),
      ).toString();

      const url = `https://workflowy.com${path}${qs ? "?" + qs : ""}`;

      logger?.info?.(`[workflowy_api] Request: ${method} ${url}`);

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body:
          method === "GET" || method === "DELETE"
            ? undefined
            : body
              ? JSON.stringify(body)
              : undefined,
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
            type: "json",
            // MCP tools usually return an array of content blocks; here we use one JSON block
            data: {
              path,
              method,
              http_status: res.status,
              ok: res.ok,
              data,
            },
          },
        ],
      };
    },
  );
});

export { handler as GET, handler as POST, handler as DELETE };
