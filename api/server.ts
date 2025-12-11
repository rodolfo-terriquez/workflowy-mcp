server.tool(
  "workflowy_api",
  {
    path: z.string().describe("Workflowy API path starting with /api/..."),
    method: z.enum(["GET", "POST", "DELETE"]).default("GET").describe("HTTP method for Workflowy"),
    query: z.record(z.any()).optional().describe("Query params for GET requests"),
    body: z.record(z.any()).optional().describe("JSON body for POST requests"),
  },
  async ({ path, method, query, body }, context) => {
    if (!path.startsWith("/api/")) {
      throw new Error("path must start with /api/");
    }

    const apiKey = process.env.WORKFLOWY_API_KEY;
    if (!apiKey) {
      throw new Error("WORKFLOWY_API_KEY is not set in process.env (Vercel env vars).");
    }

    const logger = context?.logger;

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
