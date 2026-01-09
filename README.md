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

### 3. Connect to Your MCP Client

Configure the MCP server in your AI assistant client. The authorization header format is:

```
Authorization: Bearer ACCESS_SECRET:WORKFLOWY_API_KEY
```

**📋 For detailed setup instructions with copy-paste code snippets, see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md)**

Quick links:
- **Claude Code**: Configure in `~/.claude.json` (see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md#claude-code))
- **Cursor**: Configure in `~/.cursor/mcp.json` (see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md#cursor))
- **GPT Codex**: Configure in `~/.codex/config.toml` (see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md#gpt-codex))

After configuring, restart your client for changes to take effect.

## Authentication

This server uses a **pass-through authentication** model:

1. **Access Secret** - Set in Vercel as `ACCESS_SECRET` environment variable (protects the server itself)
2. **Workflowy API Key** - Your personal API key from Workflowy (sent with each request)

**Important:** The server does NOT store your Workflowy API key. Instead:
- The server only stores the `ACCESS_SECRET` in Vercel (to prevent unauthorized access to the server)
- You provide your Workflowy API key in the client configuration
- The server validates the access secret, then uses your Workflowy API key to make requests to Workflowy

**In Vercel** (store only the access secret):
```
ACCESS_SECRET = abc123mysecret
```

**In your client** (combine both with a colon):
```
Authorization: Bearer abc123mysecret:wf_xyz789
```

This design means:
- The server doesn't store user credentials—you provide your Workflowy API key with each request
- The access secret prevents unauthorized access even if someone knows your server URL
- Only requests with both the correct access secret AND a valid Workflowy API key will succeed
- Each user can use their own Workflowy API key (useful if multiple people use the same server)

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
