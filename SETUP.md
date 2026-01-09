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

1. **Go to Workflowy API Reference**
   - Visit https://beta.workflowy.com/api-reference/
   - You may need to log in to your Workflowy account

2. **Generate/Copy Your API Key**
   - Look for your API key on the page
   - If you don't have one, there should be a button to generate it
   - **Copy your API key** - it will look something like `wf_xxxxxxxxxxxxx`
   - Keep this secure - you'll need it for the next step

## Step 4: Configure MCP Client (Claude Code)

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

## Step 5: Verify Setup

1. **Check Vercel Deployment**
   - Make sure your Vercel deployment is successful
   - Check the deployment logs for any errors

2. **Test the Connection**
   - In Claude Code, try asking: "Show me my top Workflowy notes"
   - If it works, you're all set!

## Troubleshooting

- **Database connection errors**: Double-check your `DATABASE_URL` in Vercel
- **Authentication errors**: Verify both `ACCESS_SECRET` and Workflowy API key are correct
- **404 errors**: Make sure your Vercel URL includes `/api/mcp` at the end
- **CORS errors**: Check that your Vercel project is properly deployed

## Next Steps

Once set up, you can:
- Create notes in Workflowy
- List and browse your Workflowy nodes
- Save bookmarks for quick access
- Complete/uncomplete tasks
- Move nodes around
