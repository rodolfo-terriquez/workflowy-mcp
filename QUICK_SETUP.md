# Quick Setup Summary

## ✅ Completed Steps

1. **Neon Database**: Set up and ready
   - Project: `workflowy-mcp` (noisy-poetry-29611987)
   - Connection String: `postgresql://neondb_owner:npg_NQf5vXGPeix7@ep-twilight-salad-ah1ciaes-pooler.c-3.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require`

2. **Vercel Project**: Imported and configured
   - Project Name: `workflowy-mcp`
   - Environment Variables Added:
     - `DATABASE_URL`: Your Neon connection string
     - `ACCESS_SECRET`: `fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2`

## 🚀 Next Steps

### Step 1: Deploy to Vercel
1. Click the **"Deploy"** button in the Vercel import page
2. Wait for the deployment to complete
3. Note your deployment URL (will be something like `https://workflowy-mcp-xxx.vercel.app`)

### Step 2: Get Your Workflowy API Key
1. Go to https://beta.workflowy.com/api-reference/
2. Log in to your Workflowy account
3. Copy your API key (starts with `wf_`)

### Step 3: Configure MCP Client

**📋 For detailed setup instructions with copy-paste code snippets for Claude Code, Cursor, and GPT Codex, see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md)**

Quick reference:
- **Claude Code**: `~/.claude.json`
- **Cursor**: `~/.cursor/mcp.json`
- **GPT Codex**: `~/.codex/config.toml`

Authorization header format: `Bearer ACCESS_SECRET:WORKFLOWY_API_KEY`

### Step 4: Test
1. Restart your MCP client (Claude Code, Cursor, or GPT Codex)
2. Try asking: "Show me my top Workflowy notes"

## 📝 Important Notes

- The database table (`bookmarks`) will be created automatically on first use
- Make sure your Vercel deployment URL includes `/api/mcp` at the end
- The authorization header format is: `ACCESS_SECRET:WORKFLOWY_API_KEY`
