"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  DEFAULT_TOOL_DESCRIPTIONS,
  MCP_TOOL_NAMES,
  type McpToolName,
} from "./lib/mcp-defaults";
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

interface AdminStatus {
  authenticated: boolean;
  admin_configured: boolean;
  endpoint: string;
  mcp_access_secret_configured: boolean;
  workflowy_api_key_configured: boolean;
  database_configured: boolean;
}

interface McpSettingsPayload {
  account_id: string;
  server_instructions: string | null;
  tool_descriptions: Partial<Record<McpToolName, string>>;
  default_server_instructions: string;
  default_tool_descriptions: Record<McpToolName, string>;
  tool_names: McpToolName[];
  updated_at: string | null;
}

interface ActivityLog {
  id: number;
  type: LogType;
  message: string;
  timestamp: string;
}

interface ServerLog {
  id: string | number;
  level: LogType;
  source: string;
  event: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface ServerLogsPayload {
  logs?: ServerLog[];
  total_returned?: number;
  error?: { message?: string } | string;
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
  auto_sync?: {
    attempted: boolean;
    synced: boolean;
    error?: string;
    cache_status?: CacheStatus;
  };
  error?: string;
}

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

function formatLogMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  return JSON.stringify(metadata);
}

function initParticleBackground(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return () => {};
  }
  const context = ctx;

  let frame = 0;
  let width = 0;
  let height = 0;
  const spacing = 14;
  const radius = 2.4;
  const dots: Array<{ x: number; y: number; phase: number; speed: number }> = [];

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots.length = 0;

    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        const edgeFade = Math.min(y, height - y, 260) / 260;
        dots.push({
          x,
          y,
          phase: Math.random() * Math.PI * 2,
          speed: 0.004 + Math.random() * 0.006,
        });
        if (edgeFade < 0.08) {
          dots[dots.length - 1].phase += 4;
        }
      }
    }
  }

  function draw(time: number) {
    context.fillStyle = "#171728";
    context.fillRect(0, 0, width, height);

    for (const dot of dots) {
      const edgeFade = Math.min(dot.y, height - dot.y, 300) / 300;
      const pulse = (Math.sin(time * dot.speed + dot.phase) + 1) / 2;
      const alpha = 0.05 + pulse * 0.13 * edgeFade;
      context.fillStyle = `rgba(165, 168, 252, ${alpha})`;
      context.beginPath();
      context.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
      context.fill();
    }

    frame = window.requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  frame = window.requestAnimationFrame(draw);

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}

export default function Home() {
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [appMode, setAppMode] = useState<"dashboard" | "settings">("dashboard");
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [adminSecret, setAdminSecret] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("connection");
  const [setupTab, setSetupTab] = useState<SetupTab>("claude");
  const [endpoint, setEndpoint] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "checking" | "connected" | "failed">("idle");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsPayload | null>(null);
  const [serverInstructionsDraft, setServerInstructionsDraft] = useState("");
  const [toolDescriptionDrafts, setToolDescriptionDrafts] = useState<
    Partial<Record<McpToolName, string>>
  >({});
  const [expandedTools, setExpandedTools] = useState<Set<McpToolName>>(new Set());
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [serverLogs, setServerLogs] = useState<ServerLog[]>([]);
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarkNodeId, setBookmarkNodeId] = useState("");
  const [bookmarkContext, setBookmarkContext] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchPayload["results"]>([]);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/mcp`);
    void refreshAdminSession(false);
  }, []);

  useEffect(() => {
    if (!particleCanvasRef.current) {
      return;
    }
    return initParticleBackground(particleCanvasRef.current);
  }, []);

  const isAuthenticated = Boolean(adminStatus?.authenticated);
  const serverReady = Boolean(
    adminStatus?.mcp_access_secret_configured &&
      adminStatus.workflowy_api_key_configured &&
      adminStatus.database_configured,
  );
  const canCallMcp = Boolean(endpoint && isAuthenticated && serverReady);
  const statusTone =
    !adminStatus || isAuthBusy
      ? "checking"
      : !adminStatus.admin_configured || (isAuthenticated && !serverReady)
        ? "failed"
        : connectionStatus;
  const settingsToolNames = mcpSettings?.tool_names ?? MCP_TOOL_NAMES;
  const defaultToolDescriptions =
    mcpSettings?.default_tool_descriptions ?? DEFAULT_TOOL_DESCRIPTIONS;
  const hasSettingsChanges = Boolean(
    mcpSettings &&
      (serverInstructionsDraft.trim() !==
        (mcpSettings.server_instructions ?? mcpSettings.default_server_instructions).trim() ||
        settingsToolNames.some(
          (name) =>
            (toolDescriptionDrafts[name] ?? defaultToolDescriptions[name]).trim() !==
            (mcpSettings.tool_descriptions[name] ?? defaultToolDescriptions[name]).trim(),
        )),
  );

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

  async function refreshAdminSession(showLog = true): Promise<void> {
    try {
      const response = await fetch("/api/admin/session", {
        credentials: "same-origin",
      });
      const status = (await response.json()) as AdminStatus;
      setAdminStatus(status);
      setEndpoint(status.endpoint || `${window.location.origin}/api/mcp`);
      if (!status.authenticated) {
        setConnectionStatus("idle");
        setTools([]);
        setMcpSettings(null);
        setServerInstructionsDraft("");
        setToolDescriptionDrafts({});
        setExpandedTools(new Set());
        setBookmarks([]);
        setCacheStatus(null);
        setSearchResults([]);
        setServerLogs([]);
        setAppMode("dashboard");
      }
      if (showLog) {
        addLog("info", "Admin session status refreshed.");
      }
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loginAdmin(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    setIsAuthBusy(true);
    setAuthMessage("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecret }),
      });
      const data = (await response.json()) as AdminStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setAdminStatus(data);
      setEndpoint(data.endpoint || `${window.location.origin}/api/mcp`);
      setAdminSecret("");
      setAuthMessage("");
      addLog("success", "Admin console unlocked.");
      await refreshMcpSettings(false);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function logoutAdmin(): Promise<void> {
    setIsAuthBusy(true);
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      setAdminStatus((current) =>
        current
          ? { ...current, authenticated: false }
          : null,
      );
      setConnectionStatus("idle");
      setTools([]);
      setMcpSettings(null);
      setServerInstructionsDraft("");
      setToolDescriptionDrafts({});
      setExpandedTools(new Set());
      setBookmarks([]);
      setCacheStatus(null);
      setSearchResults([]);
      setServerLogs([]);
      setAppMode("dashboard");
      addLog("info", "Admin console locked.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function mcpRequest<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!canCallMcp) {
      throw new Error("Admin session or server configuration is incomplete.");
    }

    const response = await fetch("/api/admin/mcp", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json, text/event-stream",
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
      await refreshMcpSettings(false);
      await refreshServerLogs(false);
    } catch (error) {
      setConnectionStatus("failed");
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshMcpSettings(showLog = true): Promise<void> {
    try {
      const response = await fetch("/api/admin/settings", {
        credentials: "same-origin",
      });
      const data = (await response.json()) as McpSettingsPayload & {
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      setMcpSettings(data);
      setServerInstructionsDraft(
        data.server_instructions ?? data.default_server_instructions,
      );
      setToolDescriptionDrafts({
        ...data.default_tool_descriptions,
        ...data.tool_descriptions,
      });
      if (showLog) {
        addLog("success", "MCP instructions loaded.");
      }
    } catch (error) {
      if (showLog) {
        addLog("error", error instanceof Error ? error.message : String(error));
      }
    }
  }

  function toolDescriptionOverrides(): Partial<Record<McpToolName, string>> {
    const overrides: Partial<Record<McpToolName, string>> = {};

    for (const name of settingsToolNames) {
      const value = (toolDescriptionDrafts[name] ?? "").trim();
      if (value && value !== defaultToolDescriptions[name]) {
        overrides[name] = value;
      }
    }

    return overrides;
  }

  async function saveMcpSettings(): Promise<void> {
    setIsBusy(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_instructions: serverInstructionsDraft,
          tool_descriptions: toolDescriptionOverrides(),
        }),
      });
      const data = (await response.json()) as McpSettingsPayload & {
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      setMcpSettings(data);
      setServerInstructionsDraft(
        data.server_instructions ?? data.default_server_instructions,
      );
      setToolDescriptionDrafts({
        ...data.default_tool_descriptions,
        ...data.tool_descriptions,
      });
      addLog("success", "MCP instructions saved.");
      if (connectionStatus === "connected") {
        await testConnection();
      }
    } catch (error) {
      addLog("error", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  function resetServerInstructions(): void {
    if (mcpSettings) {
      setServerInstructionsDraft(mcpSettings.default_server_instructions);
    }
  }

  function updateToolDescription(name: McpToolName, value: string): void {
    setToolDescriptionDrafts((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetToolDescription(name: McpToolName): void {
    setToolDescriptionDrafts((current) => ({
      ...current,
      [name]: defaultToolDescriptions[name],
    }));
  }

  function toggleToolExpanded(name: McpToolName): void {
    setExpandedTools((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function isToolCustomized(name: McpToolName): boolean {
    return (
      (toolDescriptionDrafts[name] ?? defaultToolDescriptions[name]).trim() !==
      defaultToolDescriptions[name].trim()
    );
  }

  async function refreshServerLogs(showLog = true): Promise<void> {
    try {
      const response = await fetch("/api/admin/logs?limit=120", {
        credentials: "same-origin",
      });
      const data = (await response.json()) as ServerLogsPayload;
      if (!response.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      setServerLogs(data.logs ?? []);
      if (showLog) {
        addLog("success", `Loaded ${data.logs?.length ?? 0} server logs.`);
      }
    } catch (error) {
      if (showLog) {
        addLog("error", error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function clearServerLogs(): Promise<void> {
    setIsBusy(true);
    try {
      const response = await fetch("/api/admin/logs", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = (await response.json()) as {
        deleted_count?: number;
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      setServerLogs([]);
      addLog("success", `Cleared ${data.deleted_count ?? 0} server logs.`);
    } catch (error) {
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
      if (result.auto_sync?.attempted) {
        addLog(
          result.auto_sync.synced ? "success" : "warning",
          result.auto_sync.synced
            ? "Cache auto-synced before search."
            : `Auto-sync skipped: ${result.auto_sync.error || "using existing cache."}`,
        );
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
        "Authorization": "Bearer MCP_ACCESS_SECRET"
      }
    }
  }
}`;

  const activeConfig =
    setupTab === "claude"
      ? claudeConfig
      : setupTab === "generic"
        ? `Endpoint: ${endpoint}\nAuthorization: Bearer MCP_ACCESS_SECRET`
        : JSON.stringify(
            {
              type: "streamable-http",
              url: endpoint,
              headers: { Authorization: "Bearer MCP_ACCESS_SECRET" },
            },
            null,
            2,
          );

  const connectionText = (() => {
    if (!adminStatus) {
      return "Checking admin session";
    }
    if (!adminStatus.admin_configured) {
      return "ADMIN_SECRET missing";
    }
    if (!isAuthenticated) {
      return "Admin console locked";
    }
    if (!serverReady) {
      return "Server configuration incomplete";
    }
    return connectionStatus === "connected"
      ? "Remote MCP connected"
      : "Ready to test connection";
  })();

  return (
    <>
      <canvas ref={particleCanvasRef} className={styles.particleCanvas} />

      {!isAuthenticated && (
        <main className={styles.dashboardWrapper}>
          <section className={styles.dashboardCard}>
            <div className={styles.dashboardHeader}>
              <img src="/wf-mcp.png" alt="" className={styles.dashboardLogo} />
              <h1>Workflowy MCP</h1>
            </div>

            <div className={styles.dashboardStatus}>
              <span className={`${styles.dashboardStatusDot} ${styles[statusTone]}`} />
              <span className={styles.dashboardStatusText}>{connectionText}</span>
            </div>

            <form className={styles.loginForm} onSubmit={loginAdmin}>
              <label className={styles.inputGroup}>
                <span>Admin Secret</span>
                <input
                  type="password"
                  value={adminSecret}
                  onChange={(event) => setAdminSecret(event.target.value)}
                  placeholder="ADMIN_SECRET"
                  disabled={!adminStatus?.admin_configured || isAuthBusy}
                />
              </label>
              <button
                className={styles.dashboardSettingsButton}
                disabled={!adminStatus?.admin_configured || !adminSecret || isAuthBusy}
                type="submit"
              >
                Unlock Console
              </button>
            </form>

            {authMessage && <p className={styles.loginMessage}>{authMessage}</p>}
            {adminStatus && !adminStatus.admin_configured && (
              <p className={styles.loginMessage}>Set ADMIN_SECRET in Vercel to enable the web console.</p>
            )}
          </section>
        </main>
      )}

      {isAuthenticated && appMode === "dashboard" && (
        <main className={styles.dashboardWrapper}>
          <section className={styles.dashboardCard}>
            <div className={styles.dashboardHeader}>
              <img src="/wf-mcp.png" alt="" className={styles.dashboardLogo} />
              <h1>Workflowy MCP</h1>
            </div>

            <div className={styles.dashboardStatus}>
              <span className={`${styles.dashboardStatusDot} ${styles[statusTone]}`} />
              <span className={styles.dashboardStatusText}>{connectionText}</span>
            </div>

            <div className={styles.dashboardInfoGrid}>
              <div className={styles.dashboardInfoItem}>
                <span className={styles.dashboardInfoLabel}>Endpoint</span>
                <span className={styles.dashboardInfoValue}>
                  {endpoint ? "Configured" : "Missing"}
                </span>
              </div>
              <div className={styles.dashboardInfoItem}>
                <span className={styles.dashboardInfoLabel}>Workflowy Key</span>
                <span className={styles.dashboardInfoValue}>
                  {adminStatus?.workflowy_api_key_configured ? "Server-side" : "Missing"}
                </span>
              </div>
              <div className={`${styles.dashboardInfoItem} ${styles.dashboardInfoFull}`}>
                <span className={styles.dashboardInfoLabel}>Cache</span>
                <span className={styles.dashboardInfoValue}>
                  {cacheStatus
                    ? `${cacheStatus.node_count.toLocaleString()} nodes`
                    : adminStatus?.database_configured
                      ? "Ready"
                      : "Database missing"}
                </span>
              </div>
            </div>

            <div className={styles.dashboardActionRow}>
              <button
                className={styles.dashboardSettingsButton}
                onClick={() => setAppMode("settings")}
                type="button"
              >
                Edit Settings
              </button>
              <button
                className={styles.dashboardSecondaryButton}
                onClick={logoutAdmin}
                type="button"
              >
                Lock
              </button>
            </div>
          </section>

          <a
            className={styles.dashboardGithubLink}
            href="https://github.com/rodolfo-terriquez/workflowy-mcp"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </main>
      )}

      {isAuthenticated && appMode === "settings" && (
    <main className={styles.appLayout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <button
            className={styles.sidebarBackButton}
            onClick={() => setAppMode("dashboard")}
            type="button"
          >
            ← Back to Dashboard
          </button>
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
          <span className={`${styles.statusDot} ${styles[statusTone]}`} />
          <span>{connectionStatus === "connected" ? "Connected" : "Admin unlocked"}</span>
        </div>
      </aside>

      <section className={styles.mainContent}>
        <div className={styles.container}>
          {activeSection === "connection" && (
            <>
              <Header title="Connection" subtitle="Verify the server-side credentials and deployed MCP endpoint." />
              <div className={styles.panel}>
                <div className={styles.gridTwo}>
                  <label className={styles.inputGroup}>
                    <span>Endpoint</span>
                    <input value={endpoint} readOnly />
                  </label>
                  <label className={styles.inputGroup}>
                    <span>Status</span>
                    <input value={connectionStatus} readOnly />
                  </label>
                </div>
                <div className={styles.buttonRow}>
                  <button className={styles.primaryButton} onClick={testConnection} disabled={isBusy || !canCallMcp} type="button">
                    Test Connection
                  </button>
                  <button className={styles.secondaryButton} onClick={() => refreshAdminSession()} disabled={isBusy} type="button">
                    Refresh Status
                  </button>
                  <button className={styles.dangerButton} onClick={logoutAdmin} type="button">
                    Lock Console
                  </button>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <Metric label="Endpoint" value={endpoint ? "configured" : "missing"} />
                <Metric label="MCP Secret" value={adminStatus?.mcp_access_secret_configured ? "configured" : "missing"} />
                <Metric label="Workflowy Key" value={adminStatus?.workflowy_api_key_configured ? "server-side" : "missing"} />
                <Metric label="Database" value={adminStatus?.database_configured ? "configured" : "missing"} />
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
              <Header title="Tools" subtitle="Customize how AI clients understand and use the hosted Workflowy tools." />
              <div className={styles.panel}>
                <label className={styles.inputGroup}>
                  <span>Server Instructions</span>
                  <textarea
                    value={serverInstructionsDraft}
                    onChange={(event) => setServerInstructionsDraft(event.target.value)}
                    rows={12}
                    placeholder={mcpSettings?.default_server_instructions ?? "Load settings to edit instructions."}
                  />
                </label>
                <div className={styles.buttonRow}>
                  <button className={styles.primaryButton} onClick={saveMcpSettings} disabled={isBusy || !mcpSettings || !hasSettingsChanges} type="button">
                    Save Customizations
                  </button>
                  <button className={styles.secondaryButton} onClick={resetServerInstructions} disabled={isBusy || !mcpSettings} type="button">
                    Reset Instructions
                  </button>
                  <button className={styles.secondaryButton} onClick={() => refreshMcpSettings()} disabled={isBusy} type="button">
                    Reload Settings
                  </button>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.sectionHeaderRow}>
                  <h2>Tool Descriptions</h2>
                  <button className={styles.secondaryButton} onClick={saveMcpSettings} disabled={isBusy || !mcpSettings || !hasSettingsChanges} type="button">
                    Save
                  </button>
                </div>
                <div className={styles.toolEditorList}>
                  {settingsToolNames.map((name) => (
                    <article key={name} className={styles.toolEditorItem}>
                      <button className={styles.toolEditorHeader} onClick={() => toggleToolExpanded(name)} type="button">
                        <span>{expandedTools.has(name) ? "▾" : "▸"}</span>
                        <strong>{name}</strong>
                        {isToolCustomized(name) && <em>customized</em>}
                      </button>
                      {expandedTools.has(name) && (
                        <div className={styles.toolEditorBody}>
                          <textarea
                            value={toolDescriptionDrafts[name] ?? defaultToolDescriptions[name]}
                            onChange={(event) => updateToolDescription(name, event.target.value)}
                            rows={4}
                          />
                          <button className={styles.secondaryButton} onClick={() => resetToolDescription(name)} disabled={!isToolCustomized(name)} type="button">
                            Reset
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>

              <Header title="Active Tools" subtitle="The tool metadata returned by the deployed MCP endpoint." />
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
              <Header title="Diagnostics" subtitle="Server-side MCP logs and recent browser-side checks." />
              <div className={styles.sectionHeaderRow}>
                <h2>Server Logs</h2>
                <div className={styles.inlineActions}>
                  <button className={styles.secondaryButton} onClick={() => refreshServerLogs()} disabled={isBusy || !isAuthenticated} type="button">
                    Refresh
                  </button>
                  <button className={styles.dangerButtonSmall} onClick={clearServerLogs} disabled={isBusy || !serverLogs.length} type="button">
                    Clear Server Logs
                  </button>
                </div>
              </div>
              <div className={styles.logContainer}>
                {serverLogs.length === 0 ? (
                  <div className={styles.logEntry}>No server logs yet.</div>
                ) : (
                  serverLogs.map((entry) => (
                    <div key={entry.id} className={`${styles.logEntry} ${styles[entry.level]}`}>
                      [{formatTime(entry.created_at)}] {entry.event}: {entry.message}
                      {formatLogMetadata(entry.metadata) && (
                        <code>{formatLogMetadata(entry.metadata)}</code>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className={styles.sectionHeaderRow}>
                <h2>Browser Activity</h2>
                <button className={styles.secondaryButton} onClick={() => setActivity([])} type="button">
                  Clear Activity
                </button>
              </div>
              <div className={styles.logContainer}>
                {activity.length === 0 ? (
                  <div className={styles.logEntry}>No browser activity yet.</div>
                ) : (
                  activity.map((entry) => (
                    <div key={entry.id} className={`${styles.logEntry} ${styles[entry.type]}`}>
                      [{formatTime(entry.timestamp)}] {entry.message}
                    </div>
                  ))
                )}
              </div>
              <div className={styles.buttonRow}>
                <button className={styles.secondaryButton} onClick={() => {
                  void refreshAdminSession();
                  void refreshCacheStatus(false);
                  void refreshServerLogs(false);
                }} disabled={isBusy} type="button">
                  Refresh Diagnostics
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
      )}
    </>
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
