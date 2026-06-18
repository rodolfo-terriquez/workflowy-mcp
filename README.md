# Workflowy MCP

A remote, self-hosted MCP server for Workflowy. Deploy it to Vercel, connect it to Neon, and use it from MCP clients that support Streamable HTTP.

This is the cloud sibling of [workflowy-local-mcp](https://github.com/rodolfo-terriquez/workflowy-local-mcp). Use the local desktop app when you want everything to stay on your machine. Use this project when you want access from places where a local MCP process is not available, such as mobile or remote Claude sessions.

## Status

This repo is being rebuilt around the newer Workflowy LLM Doc API used by `workflowy-local-mcp`.

Current remote tools:

| Tool | Description |
| --- | --- |
| `list_bookmarks` | List saved Workflowy locations and load `ai_instructions` when configured |
| `save_bookmark` | Save a node ID, special target, or Workflowy link with context notes |
| `delete_bookmark` | Delete a saved bookmark by name |
| `read_doc` | Read a node and its children through Workflowy's LLM Doc API |
| `edit_doc` | Batch insert, update, delete, or move nodes through Workflowy's LLM Doc API |
| `get_targets` | Fetch special Workflowy targets such as inbox and home |

Planned next:

- Neon-backed cache and full-text `search_nodes`
- `sync_nodes` through the `nodes-export` endpoint
- Backup tools backed by object storage
- More formal OAuth-style auth for shared/multi-user deployments
- Cloudflare deployment option

## Security Model

This project is designed for personal self-hosting.

Requests must include both:

1. `ACCESS_SECRET` - a strong secret stored in your deployment environment
2. `WORKFLOWY_API_KEY` - your Workflowy API key, sent by your MCP client on each request

The server expects this header:

```text
Authorization: Bearer ACCESS_SECRET:WORKFLOWY_API_KEY
```

The Workflowy API key is not stored in Neon. Bookmarks are stored in Neon under a SHA-256 hash of the API key so multiple keys can share one deployment without sharing bookmark data.

Remote mode changes the trust model. Your Workflowy API key is sent to your deployed server on each MCP request. If you want the key to never leave your machine, use `workflowy-local-mcp` instead.

## Deploy To Vercel

1. Fork or clone this repository.
2. Create a Neon database.
3. Import the repository into Vercel.
4. Add environment variables:

```text
DATABASE_URL=postgres://...
ACCESS_SECRET=replace-with-openssl-rand-hex-32
```

Generate a strong access secret:

```sh
openssl rand -hex 32
```

Optional origin protection:

```text
ALLOWED_ORIGINS=https://claude.ai
```

If `ALLOWED_ORIGINS` is unset, requests without an `Origin` header are allowed. If it is set, browser-originated requests must match one of the comma-separated origins.

5. Deploy.

Your MCP endpoint will be:

```text
https://YOUR-VERCEL-APP.vercel.app/api/mcp
```

## Get A Workflowy API Key

Create or copy your key from:

```text
https://beta.workflowy.com/api-reference/
```

## Connect Claude Code

Add a Streamable HTTP MCP server configuration. Replace all placeholders:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "workflowy": {
          "type": "streamable-http",
          "url": "https://YOUR-VERCEL-APP.vercel.app/api/mcp",
          "headers": {
            "Authorization": "Bearer ACCESS_SECRET:WORKFLOWY_API_KEY"
          }
        }
      }
    }
  }
}
```

## Recommended First Bookmark

If you keep AI instructions in Workflowy, save that node as `ai_instructions`:

```json
{
  "name": "ai_instructions",
  "node_id": "YOUR_NODE_ID",
  "context": "Custom instructions to read at the start of every MCP session."
}
```

After that, `list_bookmarks` will read the node and return `user_instructions`.

## Local Development

Install dependencies:

```sh
npm install
```

Create `.env.local`:

```text
DATABASE_URL=postgres://...
ACCESS_SECRET=dev-secret
```

Run Next.js:

```sh
npm run dev
```

Local endpoint:

```text
http://localhost:3000/api/mcp
```

## Notes

- Vercel Fluid compute is recommended for long-lived MCP requests.
- The Workflowy `nodes-export` endpoint is rate limited to 1 request per minute. Cache/search work should respect that limit.
- This first remote version intentionally does not store your Workflowy API key. Future hosted/multi-user versions should use a more complete authorization flow.
