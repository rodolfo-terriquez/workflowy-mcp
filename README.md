# Workflowy MCP Server

An MCP (Model Context Protocol) server that connects AI assistants to your Workflowy account, allowing them to read, create, update, and manage your Workflowy notes.

## Setup

### 1. Deploy to [Vercel](https://vercel.com/new)

1. Fork or clone this repository
2. Import the project in Vercel
3. Add environment variables in your Vercel project settings (ACCESS_SECRET is required; requests are rejected when it's not set):
   - `DATABASE_URL` - Your Neon database connection string
   - `ACCESS_SECRET` - A strong random secret to secure your server. Generate one with: `openssl rand -hex 32`
   
   Example:
   ```
   ACCESS_SECRET = abc123mysecret
   ```
4. Deploy the project

### 2. Get Your Workflowy API Key

1. Go to https://beta.workflowy.com/api-reference/
2. Generate or copy your API key
3. Keep this key secure—you'll use it to authenticate with the MCP server

### 3. Connect to Claude Code

In your MCP client, you combine both the access secret and Workflowy API key with a colon in the Authorization header:

```
Authorization: Bearer ACCESS_SECRET:WORKFLOWY_API_KEY
```

For example, if your access secret is `abc123mysecret` and your Workflowy API key is `wf_xyz789`:

```
Authorization: Bearer abc123mysecret:wf_xyz789
```

Add this to your Claude Code configuration in `~/.claude.json`:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "workflowy": {
          "type": "streamable-http",
          "url": "https://workflowy-mcp.vercel.app/api/mcp",
          "headers": {
            "Authorization": "Bearer abc123mysecret:wf_xyz789"
          }
        }
      }
    }
  }
}
```

Replace:
- `abc123mysecret` with your access secret from Vercel
- `wf_xyz789` with your Workflowy API key
- `/path/to/your/project` with your actual project directory (or use `/Users/yourusername` for global access)

The MCP server should now be available in Claude Code.

## Authentication

This server uses a two-part authentication scheme:

1. **Access Secret** - Set in Vercel as `ACCESS_SECRET` environment variable (just the secret, no colon)
2. **Workflowy API Key** - Your personal API key from Workflowy

**In Vercel** (store the access secret by itself):
```
ACCESS_SECRET = abc123mysecret
```

**In your client** (combine both with a colon):
```
Authorization: Bearer abc123mysecret:wf_xyz789
```

This design means:
- The server doesn't store credentials—you provide them with each request
- The access secret prevents unauthorized access even if someone knows your server URL
- Only requests with both the correct access secret AND a valid Workflowy API key will succeed

## Available [Workflowy API](https://beta.workflowy.com/api-reference/) Endpoints

The `workflowy_api` tool supports these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/nodes?parent_id=None` | List top-level nodes |
| GET | `/api/v1/nodes?parent_id=:id` | List children of a node |
| GET | `/api/v1/nodes/:id` | Get a single node |
| POST | `/api/v1/nodes` | Create a node (body: `name`, `parent_id`) |
| POST | `/api/v1/nodes/:id` | Update a node |
| DELETE | `/api/v1/nodes/:id` | Delete a node |
| POST | `/api/v1/nodes/:id/move` | Move a node (body: `parent_id`) |
| POST | `/api/v1/nodes/:id/complete` | Mark node as complete |
| POST | `/api/v1/nodes/:id/uncomplete` | Mark node as incomplete |
| GET | `/api/v1/nodes-export` | Export all nodes (rate limit: 1 req/min) |
| GET | `/api/v1/targets` | Get targets (inbox, home) |

The `parent_id` parameter accepts:
- A node UUID
- `"inbox"` - your Workflowy inbox
- `"home"` - your Workflowy home
- `"None"` - top-level nodes

## Example Usage

Once connected, you can ask your AI assistant things like:
- "Show me my top Workflowy notes"
- "Create a new note called 'Meeting Notes' in my inbox"
- "Mark the task 'Buy groceries' as complete"

## Local Development

```sh
npm install
npm run dev
```

## Notes

- Make sure you have [Fluid compute](https://vercel.com/docs/functions/fluid-compute) enabled in Vercel for efficient execution
- The Workflowy API has rate limits, especially for the export endpoint (1 request per minute)
