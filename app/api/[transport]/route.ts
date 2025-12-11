import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "workflowy_api",
      `Make requests to the Workflowy API. Available endpoints:
- POST /api/v1/nodes (create node: name, parent_id required in body)
- POST /api/v1/nodes/:id (update node)
- GET /api/v1/nodes/:id (get single node)
- GET /api/v1/nodes?parent_id=X (list children, parent_id can be UUID, "inbox", "home", or "None" for top-level)
- DELETE /api/v1/nodes/:id (delete node)
- POST /api/v1/nodes/:id/move (move node: parent_id required in body)
- POST /api/v1/nodes/:id/complete (mark complete)
- POST /api/v1/nodes/:id/uncomplete (mark incomplete)
- GET /api/v1/nodes-export (export all nodes, rate limit: 1/min)
- GET /api/v1/targets (get targets like inbox, home)`,
      {
        path: z
          .string()
          .describe(
            "Workflowy API path starting with /api/v1/... (e.g., /api/v1/nodes?parent_id=None)",
          ),
        method: z
          .enum(["GET", "POST", "DELETE"])
          .default("GET")
          .describe("HTTP method for Workflowy"),
        query: z.record(z.any()).optional().describe("Query params for GET requests"),
        body: z.record(z.any()).optional().describe("JSON body for POST requests"),
      },
      async ({
        path,
        method,
        query,
        body,
      }: {
        path: string;
        method: string;
        query?: Record<string, unknown>;
        body?: Record<string, unknown>;
      }) => {
        if (!path.startsWith("/api/")) {
          throw new Error("path must start with /api/");
        }

        const apiKey = process.env.WORKFLOWY_API_KEY;
        if (!apiKey) {
          throw new Error("WORKFLOWY_API_KEY is not set in process.env (Vercel env vars).");
        }

        const qs = new URLSearchParams(
          Object.entries(query || {}).reduce<Record<string, string>>((acc, [k, v]) => {
            if (v !== undefined && v !== null) acc[k] = String(v);
            return acc;
          }, {}),
        ).toString();

        const url = `https://workflowy.com${path}${qs ? "?" + qs : ""}`;

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
              type: "text",
              text: JSON.stringify(
                {
                  path,
                  method,
                  http_status: res.status,
                  ok: res.ok,
                  data,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  },
  {},
  {
    basePath: "/api",
  },
);

export { handler as GET, handler as POST };
