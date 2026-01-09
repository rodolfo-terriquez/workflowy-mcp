# Step-by-Step Setup Guide

## Prerequisites
- ✅ Vercel account linked to GitHub
- ✅ Access secret: `fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2`

## Step 1: Create Neon Database

1. **Sign up/Login to Neon**
   - Go to https://neon.tech
   - Sign up for a free account (or login if you already have one)

2. **Create a New Project**
   - Click "Create Project" or "New Project"
   - Choose a project name (e.g., "workflowy-mcp")
   - Select a region close to you
   - Choose PostgreSQL version (default is fine)
   - Click "Create Project"

3. **Get Your Connection String**
   - Once the project is created, you'll see a dashboard
   - Look for a "Connection String" or "Connection Details" section
   - Click on "Connection Details" or the connection string field
   - You should see something like:
     ```
     postgresql://username:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```
   - **Copy this entire connection string** - you'll need it in the next step

## Step 2: Configure Vercel Environment Variables

1. **Go to Your Vercel Project**
   - Open https://vercel.com/dashboard
   - Find your `workflowy-mcp` project (or import it if not already deployed)
   - Click on the project name

2. **Navigate to Settings**
   - Click on "Settings" in the top navigation
   - Click on "Environment Variables" in the left sidebar

3. **Add DATABASE_URL**
   - Click "Add New"
   - **Key:** `DATABASE_URL`
   - **Value:** Paste the Neon connection string you copied in Step 1
   - **Environment:** Select "Production", "Preview", and "Development" (or just "Production" if you prefer)
   - Click "Save"

4. **Add ACCESS_SECRET**
   - Click "Add New" again
   - **Key:** `ACCESS_SECRET`
   - **Value:** `fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2`
   - **Environment:** Select "Production", "Preview", and "Development"
   - Click "Save"

5. **Redeploy Your Project**
   - Go to the "Deployments" tab
   - Find your latest deployment
   - Click the three dots (⋯) menu
   - Click "Redeploy"
   - Or push a new commit to trigger a redeploy

## Step 3: Get Your Workflowy API Key

**Important:** The server does NOT store your Workflowy API key. You'll need to provide it in your client configuration (Cursor/Claude Code). This is by design - it means:
- The server doesn't need to store user credentials
- You can use your own personal Workflowy API key
- Multiple users can use the same server with their own keys

1. **Go to Workflowy API Reference**
   - Visit https://beta.workflowy.com/api-reference/
   - You may need to log in to your Workflowy account

2. **Generate/Copy Your API Key**
   - Look for your API key on the page
   - If you don't have one, there should be a button to generate it
   - **Copy your API key** - it will look something like `wf_xxxxxxxxxxxxx`
   - Keep this secure - you'll need it for the next step (you'll add it to your Cursor/Claude Code config)

## Step 4: Configure MCP Client

**📋 For quick copy-paste configuration snippets, see [MCP_CLIENT_SETUP.md](./MCP_CLIENT_SETUP.md)**

The following sections provide detailed instructions. For Claude Code, Cursor, and GPT Codex setup with ready-to-use code snippets, refer to the [MCP Client Setup Guide](./MCP_CLIENT_SETUP.md).

### Configure MCP Client (Claude Code)

1. **Find Your Claude Code Config File**
   - The config file is located at `~/.claude.json`
   - On macOS/Linux, this is `/Users/yourusername/.claude.json`

2. **Edit the Config File**
   - Open `~/.claude.json` in a text editor
   - If it doesn't exist, create it

3. **Add MCP Server Configuration**
   - Add or update the configuration with your project path and MCP server details
   - Replace the following values:
     - `ACCESS_SECRET`: `fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2`
     - `WORKFLOWY_API_KEY`: Your Workflowy API key from Step 3
     - `/path/to/your/project`: Your actual project directory (or use `/Users/travis` for global access)
     - `https://workflowy-mcp.vercel.app`: Your actual Vercel deployment URL (check your Vercel dashboard)

   Example configuration:
   ```json
   {
     "projects": {
       "/Users/travis/Dev/workflowy-mcp": {
         "mcpServers": {
           "workflowy": {
             "type": "streamable-http",
             "url": "https://your-project-name.vercel.app/api/mcp",
             "headers": {
               "Authorization": "Bearer fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2:YOUR_WORKFLOWY_API_KEY"
             }
           }
         }
       }
     }
   }
   ```

4. **Save the File**
   - Save `~/.claude.json`
   - Restart Claude Code if it's running

### Configure MCP Client (Cursor)

You can configure Cursor in one of two ways:

### Option A: Configuration File (Recommended)

1. **Find Your Cursor MCP Config File**
   - The config file is located at `~/.cursor/mcp.json`
   - On macOS/Linux, this is `/Users/yourusername/.cursor/mcp.json`

2. **Edit the Config File**
   - Open `~/.cursor/mcp.json` in a text editor
   - If it doesn't exist, create it (and the `.cursor` directory if needed)

3. **Add MCP Server Configuration**
   - Replace the following values:
     - `ACCESS_SECRET`: `fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2`
     - `WORKFLOWY_API_KEY`: Your Workflowy API key from Step 3
     - `https://workflowy-mcp.vercel.app`: Your actual Vercel deployment URL (check your Vercel dashboard)

   Example configuration:
   ```json
   {
     "mcpServers": {
       "workflowy": {
         "type": "streamable-http",
         "url": "https://your-project-name.vercel.app/api/mcp",
         "headers": {
           "Authorization": "Bearer fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2:YOUR_WORKFLOWY_API_KEY"
         }
       }
     }
   }
   ```

4. **Save the File**
   - Save `~/.cursor/mcp.json`
   - Restart Cursor if it's running

### Option B: Cursor Settings UI

1. **Open Cursor Settings**
   - Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
   - Or go to Cursor → Settings (Mac) / File → Preferences → Settings (Windows/Linux)

2. **Navigate to MCP Settings**
   - Search for "MCP" or "Model Context Protocol" in the settings search bar
   - Or navigate to Features → Model Context Protocol

3. **Add MCP Server**
   - Click "Add Server" or "Edit Servers"
   - Fill in the following:
     - **Name:** `workflowy`
     - **Type:** `streamable-http`
     - **URL:** `https://your-project-name.vercel.app/api/mcp`
     - **Headers:** 
       ```json
       {
         "Authorization": "Bearer fce625966d398a6a34200b4778185db96785114731bf6fce40aa2b241ee06ee2:YOUR_WORKFLOWY_API_KEY"
       }
       ```
   - Replace `YOUR_WORKFLOWY_API_KEY` with your actual Workflowy API key from Step 3
   - Replace `https://your-project-name.vercel.app` with your actual Vercel deployment URL

4. **Save and Restart**
   - Save the settings
   - Restart Cursor for the changes to take effect

## Step 6: Verify Setup

1. **Check Vercel Deployment**
   - Make sure your Vercel deployment is successful
   - Check the deployment logs for any errors

2. **Test the Connection**
   - In Claude Code, try asking: "Show me my top Workflowy notes"
   - In Cursor, try asking: "Show me my top Workflowy notes"
   - In GPT Codex, try asking: "Show me my top Workflowy notes"
   - If it works, you're all set!

## Troubleshooting

- **Database connection errors**: Double-check your `DATABASE_URL` in Vercel
- **Authentication errors**: Verify both `ACCESS_SECRET` and Workflowy API key are correct
- **404 errors**: Make sure your Vercel URL includes `/api/mcp` at the end
- **CORS errors**: Check that your Vercel project is properly deployed
- **"Why do I need to provide my Workflowy API key in the client?"**: The server uses a pass-through authentication model - it doesn't store your Workflowy API key. The server only stores the `ACCESS_SECRET` (to protect the server), and you provide your Workflowy API key in the client config. This allows multiple users to use the same server with their own keys.

## Next Steps

Once set up, you can:
- Create notes in Workflowy
- List and browse your Workflowy nodes
- Save bookmarks for quick access
- Complete/uncomplete tasks
- Move nodes around
