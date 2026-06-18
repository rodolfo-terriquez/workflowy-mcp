import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = process.argv[2] || "http://localhost:3000";
const bearerToken = process.env.WORKFLOWY_MCP_AUTH;

async function main() {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${origin}/api/mcp`),
    bearerToken
      ? {
          requestInit: {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          },
        }
      : undefined,
  );

  const client = new Client(
    {
      name: "example-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
    }
  );

  await client.connect(transport);

  console.log("Connected", client.getServerCapabilities());

  const result = await client.listTools();
  console.log(result);
}

main();
