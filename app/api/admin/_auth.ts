import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import packageJson from "../../../package.json";

export const ADMIN_COOKIE_NAME = "workflowy_mcp_admin";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

interface SessionPayload {
  exp: number;
  iat: number;
}

export interface AdminStatus {
  authenticated: boolean;
  admin_configured: boolean;
  version: string;
  endpoint: string;
  mcp_access_secret_configured: boolean;
  workflowy_api_key_configured: boolean;
  database_configured: boolean;
}

function getRequiredEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getAdminSecret(): string {
  return getRequiredEnv("ADMIN_SECRET");
}

export function getMcpAccessSecret(): string {
  return getRequiredEnv("MCP_ACCESS_SECRET") || getRequiredEnv("ACCESS_SECRET");
}

export function getWorkflowyApiKey(): string {
  return getRequiredEnv("WORKFLOWY_API_KEY");
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

export function adminSecretMatches(secret: string): boolean {
  const adminSecret = getAdminSecret();
  if (!adminSecret) {
    return false;
  }
  return timingSafeStringEqual(secret, adminSecret);
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iat: now, exp: now + SESSION_TTL_SECONDS } satisfies SessionPayload),
  ).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

function readSessionPayload(token: string, secret: string): SessionPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return null;
  }

  if (!timingSafeStringEqual(signature, signPayload(payload, secret))) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isAdminAuthenticated(request: NextRequest): boolean {
  const adminSecret = getAdminSecret();
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!adminSecret || !token) {
    return false;
  }
  return Boolean(readSessionPayload(token, adminSecret));
}

export function setAdminSessionCookie(response: NextResponse): void {
  const adminSecret = getAdminSecret();
  if (!adminSecret) {
    return;
  }

  response.cookies.set(ADMIN_COOKIE_NAME, createSessionToken(adminSecret), {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function buildAdminStatus(request: NextRequest, authenticated: boolean): AdminStatus {
  const origin = new URL(request.url).origin;
  return {
    authenticated,
    admin_configured: Boolean(getAdminSecret()),
    version: packageJson.version,
    endpoint: `${origin}/api/mcp`,
    mcp_access_secret_configured: Boolean(getMcpAccessSecret()),
    workflowy_api_key_configured: Boolean(getWorkflowyApiKey()),
    database_configured: Boolean(getRequiredEnv("DATABASE_URL")),
  };
}

export function unauthorizedJson(message = "Admin session required"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}
