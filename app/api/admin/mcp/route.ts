import { NextRequest, NextResponse } from "next/server";
import {
  getMcpAccessSecret,
  getWorkflowyApiKey,
  isAdminAuthenticated,
  unauthorizedJson,
} from "../_auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  const accessSecret = getMcpAccessSecret();
  if (!accessSecret) {
    return NextResponse.json(
      { error: { message: "MCP_ACCESS_SECRET is not configured." } },
      { status: 503 },
    );
  }

  if (!getWorkflowyApiKey()) {
    return NextResponse.json(
      { error: { message: "WORKFLOWY_API_KEY is not configured." } },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const body = await request.text();
  const response = await fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      Accept: request.headers.get("accept") ?? "application/json, text/event-stream",
      Authorization: `Bearer ${accessSecret}`,
      "Content-Type": request.headers.get("content-type") ?? "application/json",
    },
    body,
  });

  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
