"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Section = "connection" | "setup" | "tools" | "bookmarks" | "cache" | "diagnostics";
type SetupTab = "claude" | "generic" | "json";
type LogType = "info" | "success" | "error" | "warning";

interface ToolInfo {
  name: string;
  description?: string;
}

interface Bookmark {
  name: string;
  node_id: string;
  context?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface CacheStatus {
  node_count: number;
  last_synced_at: string;
  is_stale: boolean;
  sync_in_progress: boolean;
}

interface ActivityLog {
  id: number;
  type: LogType;
  message: string;
  timestamp: string;
}

interface McpResponse<T = unknown> {
  result?: T;
  error?: { message?: string; code?: number } | string;
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
}

interface ListBookmarksPayload {
  bookmarks?: Bookmark[];
  user_instructions?: string;
  action_required?: string;
}

interface SearchPayload {
  results?: Array<{
    id: string;
    name: string;
    path_display?: string;
    children_count?: number;
    relevance_score?: number | null;
  }>;
  total_found?: number;
  cache_status?: CacheStatus;
  error?: string;
}

const STORAGE_KEY = "workflowy-mcp-console";
const navItems: Array<{ id: Section; label: string }> = [
  { id: "connection", label: "Connection" },
  { id: "setup", label: "Setup" },
  { id: "tools", label: "Tools" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "cache", label: "Cache" },
  { id: "diagnostics", label: "Diagnostics" },
];

function parseSseJson(text: string): McpResponse {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));
  const jsonText = dataLine ? dataLine.slice(6) : text;
  return JSON.parse(jsonText) as McpResponse;
}

function extractToolText(result: ToolCallResult): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

function parseToolJson<T>(result: ToolCallResult): T {
  return JSON.parse(extractToolText(result)) as T;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function maskSecret(value: string): string {
  if (!value) {
    return "not set";
  }
  if (value.length <= 10) {
    return "configured";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<Section>("connection");
  const [setupTab, setSetupTab] = useState<SetupTab>("claude");
  const [endpoint, setEndpoint] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [workflowyApiKey, setWorkflowyApiKey] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "checking" | "connected" | "failed">("idle");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkNodeId, setBookmarkNodeId] = useState("");
  const [bookmarkContext, setBookmarkContext] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchPayload["results"]>([]);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const origin = window.location.origin;
    setEndpoint(`${origin}/api/mcp`);
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          endpoint?: string;
          accessSecret?: string;
          workflowyApiKey?: string;
        };
        setEndpoint(parsed.endpoint || `${origin}/api/mcp`);
        setAccessSecret(parsed.accessSecret || "");
        setWorkflowyApiKey(parsed.workflowyApiKey || "");
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const authToken = useMemo(
    () => `${accessSecret.trim()}:${workflowyApiKey.trim()}`,
    [accessSecret, workflowyApiKey],
  );

  const authHeader = useMemo(
    () => `Bearer ${authToken}`,
    [authToken],
  );

  const canCallMcp = Boolean(endpoint && accessSecret.trim() && workflowyApiKey.trim());

  function addLog(type: LogType, message: string): void {
    setActivity((current) => [
      ...current.slice(-80),
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        type,
        message,
        timestamp: new Date().toISOString(),
      },
    ]);
  }

  function saveLocalSettings(): void {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ endpoint, accessSecret, workflowyApiKey }),
    );
    addLog("success", "Connection settings saved in this browser.");
  }

  function clearLocalSettings(): void {
    window.localStorage.removeItem(STORAGE_KEY);
    setAccessSecret("");
    setWorkflowyApiKey("");
    setTools([]);
    setBookmarks([]);
    setCacheStatus(null);
    setSearchResults([]);
    setConnectionStatus("idle");
    addLog("info", "Local connection settings cleared.");
  }

  async function mcpRequest<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!canCallMcp) {
      throw new Error("Connection fields are incomplete.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    const text = await response.text();
    const parsed = parseSseJson(text);

    if (!response.ok || parsed.error) {
      const message =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return parsed.result as T;
  }

  async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await mcpRequest<ToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
    return parseToolJson<T>(result);
  }

  async function testConnection(): Promise<void> {
    setIsBusy(true);
    setConnectionStatus("checking");
    try {
      const init = await mcpRequest<{ serverInfo?: { name?: string }; protocolVersion?: string }>("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "workflowy-mcp-web-console", version: "0.1.0" },
      });
      const toolList = await mcpRequest<{ tools: ToolInfo[] }>("tools/list", {});
      setTools(toolList.tools ?? []);
      setConnectionStatus("connected");
      addLog(
        "success",
        `Connected to ${init.serverInfo?.name || "Workflowy MCP"} with ${toolList.tools?.length ?? 0} tools.`,
      );
      await refreshCacheStatus(false);
      await refreshBookmarks(false);
    } catch (error) {
      setConnectionStatus("failed");
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshBookmarks(showLog = true): Promise<void> {
    setIsBusy(true);
    try {
      const result = await callTool<ListBookmarksPayload>("list_bookmarks");
      setBookmarks(result.bookmarks ?? []);
      if (showLog) {
        addLog("success", `Loaded ${result.bookmarks?.length ?? 0} bookmarks.`);
      }
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveBookmark(): Promise<void> {
    setIsBusy(true);
    try {
      await callTool("save_bookmark", {
        name: bookmarkName.trim(),
        node_id: bookmarkNodeId.trim(),
        context: bookmarkContext.trim(),
      });
      setBookmarkName("");
      setBookmarkNodeId("");
      setBookmarkContext("");
      addLog("success", "Bookmark saved.");
      await refreshBookmarks(false);
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteBookmark(name: string): Promise<void> {
    setIsBusy(true);
    try {
      await callTool("delete_bookmark", { name });
      addLog("success", `Deleted bookmark ${name}.`);
      await refreshBookmarks(false);
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshCacheStatus(showLog = true): Promise<void> {
    try {
      const result = await callTool<CacheStatus>("cache_status");
      setCacheStatus(result);
      if (showLog) {
        addLog("success", `Cache has ${result.node_count.toLocaleString()} nodes.`);
      }
    } catch (error) {
      if (showLog) {
        addLog("error", error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function syncNodes(): Promise<void> {
    setIsBusy(true);
    try {
      const result = await callTool<{
        success?: boolean;
        nodes_synced?: number;
        error?: string;
        cache_status?: CacheStatus;
      }>("sync_nodes");
      if (!result.success) {
        throw new Error(result.error || "Sync failed.");
      }
      setCacheStatus(result.cache_status ?? null);
      addLog("success", `Synced ${(result.nodes_synced ?? 0).toLocaleString()} nodes.`);
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function searchNodes(): Promise<void> {
    setIsBusy(true);
    try {
      const result = await callTool<SearchPayload>("search_nodes", {
        query: searchQuery.trim(),
        limit: 8,
      });
      setSearchResults(result.results ?? []);
      if (result.cache_status) {
        setCacheStatus(result.cache_status);
      }
      if (result.error) {
        addLog("warning", result.error);
      } else {
        addLog("success", `Found ${result.total_found ?? 0} results.`);
      }
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  function copyText(value: string, label: string): void {
    void navigator.clipboard.writeText(value);
    addLog("success", `${label} copied.`);
  }

  const claudeConfig = `{
  "mcpServers": {
    "workflowy": {
      "type": "streamable-http",
      "url": "${endpoint || "https://YOUR-APP.vercel.app/api/mcp"}",
      "headers": {
        "Authorization": "Bearer ${canCallMcp ? authToken : "ACCESS_SECRET:WORKFLOWY_API_KEY"}"
      }
    }
  }
}`;

  const activeConfig =
    setupTab === "claude"
      ? claudeConfig
      : setupTab === "generic"
        ? `Endpoint: ${endpoint}\nAuthorization: Bearer ${authToken}`
        : JSON.stringify(
            {
              type: "streamable-http",
              url: endpoint,
              headers: { Authorization: "Bearer ACCESS_SECRET:WORKFLOWY_API_KEY" },
            },
            null,
            2,
          );

  return (
    <main className={styles.appLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <img src="/wf-mcp.png" alt="" className={styles.logo} />
          <div>
            <h1>Workflowy MCP</h1>
            <p>Remote console</p>
          </div>
        </div>

        <nav className={styles.sidebarNav}>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`${styles.navItem} ${activeSection === item.id ? styles.active : ""}`}
              onClick={() => setActiveSection(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <span className={`${styles.statusDot} ${styles[connectionStatus]}`} />
          <span>{connectionStatus === "connected" ? "Connected" : "Not connected"}</span>
        </div>
      </aside>

      <section className={styles.mainContent}>
        <div className={styles.container}>
          {activeSection === "connection" && (
            <>
              <Header title="Connection" subtitle="Configure browser-local credentials and verify the deployed MCP endpoint." />
              <div className={styles.panel}>
                <div className={styles.gridTwo}>
                  <label className={styles.inputGroup}>
                    <span>Endpoint</span>
                    <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
                  </label>
                  <label className={styles.inputGroup}>
                    <span>Status</span>
                    <input value={connectionStatus} readOnly />
                  </label>
                </div>
                <label className={styles.inputGroup}>
                  <span>Access Secret</span>
                  <input
                    type="password"
                    value={accessSecret}
                    onChange={(event) => setAccessSecret(event.target.value)}
                    placeholder="Vercel ACCESS_SECRET"
                  />
                </label>
                <label className={styles.inputGroup}>
                  <span>Workflowy API Key</span>
                  <input
                    type="password"
                    value={workflowyApiKey}
                    onChange={(event) => setWorkflowyApiKey(event.target.value)}
                    placeholder="Workflowy API key"
                  />
                </label>
                <div className={styles.buttonRow}>
                  <button className={styles.primaryButton} onClick={testConnection} disabled={isBusy || !canCallMcp} type="button">
                    Test Connection
                  </button>
                  <button className={styles.secondaryButton} onClick={saveLocalSettings} disabled={!canCallMcp} type="button">
                    Save Locally
                  </button>
                  <button className={styles.dangerButton} onClick={clearLocalSettings} type="button">
                    Clear
                  </button>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <Metric label="Endpoint" value={endpoint ? "configured" : "missing"} />
                <Metric label="Access Secret" value={maskSecret(accessSecret)} />
                <Metric label="Workflowy Key" value={maskSecret(workflowyApiKey)} />
                <Metric label="Tools" value={tools.length ? String(tools.length) : "not loaded"} />
              </div>
            </>
          )}

          {activeSection === "setup" && (
            <>
              <Header title="Setup" subtitle="Generate the remote MCP configuration for your client." />
              <div className={styles.tabs}>
                <button className={`${styles.tab} ${setupTab === "claude" ? styles.tabActive : ""}`} onClick={() => setSetupTab("claude")} type="button">
                  Claude
                </button>
                <button className={`${styles.tab} ${setupTab === "generic" ? styles.tabActive : ""}`} onClick={() => setSetupTab("generic")} type="button">
                  Header
                </button>
                <button className={`${styles.tab} ${setupTab === "json" ? styles.tabActive : ""}`} onClick={() => setSetupTab("json")} type="button">
                  JSON
                </button>
              </div>
              <div className={styles.panel}>
                <div className={styles.buttonRow}>
                  <button className={styles.secondaryButton} onClick={() => copyText(activeConfig, "Configuration")} type="button">
                    Copy
                  </button>
                  <button className={styles.secondaryButton} onClick={() => copyText(endpoint, "Endpoint")} type="button">
                    Copy Endpoint
                  </button>
                </div>
                <pre className={styles.codeBlock}>{activeConfig}</pre>
              </div>
            </>
          )}

          {activeSection === "tools" && (
            <>
              <Header title="Tools" subtitle="Inspect the active remote MCP tool surface." />
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} onClick={testConnection} disabled={isBusy || !canCallMcp} type="button">
                  Reload Tools
                </button>
              </div>
              <div className={styles.list}>
                {tools.length === 0 ? (
                  <EmptyState text="Connect first to load tools." />
                ) : (
                  tools.map((tool) => (
                    <article key={tool.name} className={styles.itemCard}>
                      <h2>{tool.name}</h2>
                      <p>{tool.description || "No description returned."}</p>
                    </article>
                  ))
                )}
              </div>
            </>
          )}

          {activeSection === "bookmarks" && (
            <>
              <Header title="Bookmarks" subtitle="Manage remote bookmarks stored in Neon for this Workflowy key." />
              <div className={styles.panel}>
                <div className={styles.gridTwo}>
                  <label className={styles.inputGroup}>
                    <span>Name</span>
                    <input value={bookmarkName} onChange={(event) => setBookmarkName(event.target.value)} placeholder="ai_instructions" />
                  </label>
                  <label className={styles.inputGroup}>
                    <span>Node ID</span>
                    <input value={bookmarkNodeId} onChange={(event) => setBookmarkNodeId(event.target.value)} placeholder="inbox, today, or a node id" />
                  </label>
                </div>
                <label className={styles.inputGroup}>
                  <span>Context</span>
                  <textarea value={bookmarkContext} onChange={(event) => setBookmarkContext(event.target.value)} rows={3} />
                </label>
                <div className={styles.buttonRow}>
                  <button className={styles.primaryButton} onClick={saveBookmark} disabled={isBusy || !bookmarkName || !bookmarkNodeId || !canCallMcp} type="button">
                    Save Bookmark
                  </button>
                  <button className={styles.secondaryButton} onClick={() => refreshBookmarks()} disabled={isBusy || !canCallMcp} type="button">
                    Refresh
                  </button>
                </div>
              </div>
              <div className={styles.list}>
                {bookmarks.length === 0 ? (
                  <EmptyState text="No bookmarks saved yet." />
                ) : (
                  bookmarks.map((bookmark) => (
                    <article key={bookmark.name} className={styles.itemCard}>
                      <div className={styles.itemHeader}>
                        <h2>{bookmark.name}</h2>
                        <button className={styles.dangerButtonSmall} onClick={() => deleteBookmark(bookmark.name)} type="button">
                          Delete
                        </button>
                      </div>
                      <code>{bookmark.node_id}</code>
                      <p>{bookmark.context || "No context set."}</p>
                    </article>
                  ))
                )}
              </div>
            </>
          )}

          {activeSection === "cache" && (
            <>
              <Header title="Cache" subtitle="Sync and search the Neon-backed Workflowy cache." />
              <div className={styles.summaryGrid}>
                <Metric label="Nodes" value={cacheStatus ? cacheStatus.node_count.toLocaleString() : "unknown"} />
                <Metric label="Last Sync" value={cacheStatus?.last_synced_at === "never" || !cacheStatus ? "never" : new Date(cacheStatus.last_synced_at).toLocaleString()} />
                <Metric label="Freshness" value={cacheStatus ? (cacheStatus.is_stale ? "stale" : "fresh") : "unknown"} />
                <Metric label="Sync" value={cacheStatus?.sync_in_progress ? "running" : "idle"} />
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} onClick={syncNodes} disabled={isBusy || !canCallMcp} type="button">
                  Sync Nodes
                </button>
                <button className={styles.secondaryButton} onClick={() => refreshCacheStatus()} disabled={isBusy || !canCallMcp} type="button">
                  Refresh Status
                </button>
              </div>
              <div className={styles.panel}>
                <div className={styles.searchRow}>
                  <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search Workflowy cache" />
                  <button className={styles.secondaryButton} onClick={searchNodes} disabled={isBusy || !searchQuery || !canCallMcp} type="button">
                    Search
                  </button>
                </div>
              </div>
              <div className={styles.list}>
                {searchResults?.length ? (
                  searchResults.map((result) => (
                    <article key={result.id} className={styles.itemCard}>
                      <h2>{result.name || "(Untitled)"}</h2>
                      <p>{result.path_display || result.id}</p>
                      <div className={styles.metaRow}>
                        <span>{result.children_count ?? 0} children</span>
                        <span>score {result.relevance_score ?? "n/a"}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyState text="Search results will appear here." />
                )}
              </div>
            </>
          )}

          {activeSection === "diagnostics" && (
            <>
              <Header title="Diagnostics" subtitle="Recent browser-side checks and MCP calls." />
              <div className={styles.logContainer}>
                {activity.length === 0 ? (
                  <div className={styles.logEntry}>No activity yet.</div>
                ) : (
                  activity.map((entry) => (
                    <div key={entry.id} className={`${styles.logEntry} ${styles[entry.type]}`}>
                      [{formatTime(entry.timestamp)}] {entry.message}
                    </div>
                  ))
                )}
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} onClick={() => setActivity([])} type="button">
                  Clear Logs
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className={styles.header}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className={styles.emptyState}>{text}</div>;
}
