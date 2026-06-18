# Workflowy MCP

A remote, self-hosted MCP server for Workflowy. Deploy it to Vercel, connect it to Neon, and use it from MCP clients that support Streamable HTTP.

This is the cloud sibling of [workflowy-local-mcp](https://github.com/rodolfo-terriquez/workflowy-local-mcp). Use the local desktop app when you want everything to stay on your machine. Use this project when you want access from places where a local MCP process is not available, such as mobile or remote Claude sessions.

## Status

This repo uses the newer Workflowy LLM Doc API from `workflowy-local-mcp`, adapted for a remote self-hosted deployment.

The root web page is an owner-only console for testing the MCP connection, customizing AI instructions/tool descriptions, managing bookmarks, syncing/searching the cache, viewing server logs, and copying client configuration.

Current remote tools:

| Tool | Description |
| --- | --- |
| `list_bookmarks` | List saved Workflowy locations and load `ai_instructions` when configured |
| `save_bookmark` | Save a node ID, special target, or Workflowy link with context notes |
| `delete_bookmark` | Delete a saved bookmark by name |
| `read_doc` | Read a node and its children through Workflowy's LLM Doc API |
| `edit_doc` | Batch insert, update, delete, or move nodes through Workflowy's LLM Doc API |
| `search_nodes` | Search the Neon-backed Workflowy cache, with safe auto-sync when empty or stale |
| `sync_nodes` | Refresh the Neon-backed cache from Workflowy's full export |
| `cache_status` | Show cache freshness and node count without running a search |
| `get_targets` | Fetch special Workflowy targets such as inbox and home |

Planned next:

- More formal OAuth-style auth for shared/multi-user deployments
- Optional multi-account support for one hosted deployment
- Cloudflare deployment option

## Security Model

This project is designed for personal self-hosting.

Requests must include both:

1. `MCP_ACCESS_SECRET` - a strong secret stored in your deployment environment and sent by your MCP client
2. `WORKFLOWY_API_KEY` - your Workflowy API key, stored only in the deployment environment

The server expects this header:

```text
Authorization: Bearer MCP_ACCESS_SECRET
```

The root web console is protected separately with `ADMIN_SECRET`. Entering the admin secret sets a short-lived, signed, HTTP-only cookie so only the deployment owner can access the interface.

The Workflowy API key is not stored in Neon or browser local storage. Bookmarks, cache rows, custom MCP settings, and server-side MCP logs are stored in Neon under a SHA-256 hash of the API key.

Remote mode changes the trust model. Your Workflowy API key is stored in your deployed server environment. If you want the key to never leave your machine, use `workflowy-local-mcp` instead.

## Deploy To Vercel

1. Fork or clone this repository.
2. Create a Neon database.
3. Import the repository into Vercel.
4. Add environment variables:

```text
DATABASE_URL=postgres://...
ADMIN_SECRET=replace-with-openssl-rand-hex-32
MCP_ACCESS_SECRET=replace-with-another-openssl-rand-hex-32
WORKFLOWY_API_KEY=your-workflowy-api-key
```

Generate strong secrets:

```sh
openssl rand -hex 32
```

Optional origin protection:

```text
ALLOWED_ORIGINS=https://claude.ai
```

If `ALLOWED_ORIGINS` is unset, requests without an `Origin` header are allowed. If it is set, browser-originated requests must match one of the comma-separated origins.

5. Deploy.

Open the deployed URL to use the setup console:

```text
https://YOUR-VERCEL-APP.vercel.app/
```

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
            "Authorization": "Bearer MCP_ACCESS_SECRET"
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
ADMIN_SECRET=dev-admin-secret
MCP_ACCESS_SECRET=dev-mcp-secret
WORKFLOWY_API_KEY=wf_...
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
- `sync_nodes` replaces the remote cache for the configured Workflowy API key. `search_nodes` will attempt a safe auto-sync when the cache is empty or stale and the export rate limit allows it.
- Successful `edit_doc` calls trigger a targeted cache refresh for affected nodes/parent lists and mark the full cache stale for later reconciliation.
- Backup tools are intentionally not included in the remote server. This project is focused on remote read/write/search and owner-managed setup.
- The legacy `Authorization: Bearer ACCESS_SECRET:WORKFLOWY_API_KEY` format still works for older clients when `ACCESS_SECRET` is configured, but new deployments should use `MCP_ACCESS_SECRET` and server-side `WORKFLOWY_API_KEY`.
