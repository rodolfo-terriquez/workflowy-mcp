# Workflowy MCP Server

An MCP (Model Context Protocol) server that connects AI assistants to your Workflowy account, allowing them to read, create, update, and manage your Workflowy notes.

## Setup

### 1. Deploy to [Vercel](https://vercel.com/new)

1. Fork or clone this repository
2. Import the project in Vercel
3. Add your Neon database URL as an environment variable:
   - Go to your project settings in Vercel
   - Navigate to **Environment Variables**
   - Add a new variable:
     - Name: `DATABASE_URL`
     - Value: Your Neon database connection string
4. Deploy the project

### 2. Get Your Workflowy API Key

1. Go to https://beta.workflowy.com/api-reference/
2. Generate or copy your API key
3. Keep this key secure—you'll use it to authenticate with the MCP server

### 3. Connect to Claude Code

Add the MCP server to your Claude Code configuration in `~/.claude.json`, you can ask Claude Code to add the configuration for you:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "workflowy": {
          "type": "streamable-http",
          "url": "https://workflowy-mcp.vercel.app/api/mcp",
          "headers": {
            "Authorization": "Bearer <your-workflowy-api-key>"
          }
        }
      }
    }
  }
}
```

Replace `/path/to/your/project` with your actual project directory (or use `/Users/yourusername` for global access).

The MCP server should now be available in Claude Code.

## Authentication

This server requires your Workflowy API key to be passed in the `Authorization` header with every request:

```
Authorization: Bearer <your-workflowy-api-key>
```

This design means:
- The server doesn't store your API key—you provide it with each request
- Only people with a valid Workflowy API key can use the server
- You can share the server URL publicly; it's useless without a valid key

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
