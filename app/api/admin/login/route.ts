import { NextRequest, NextResponse } from "next/server";
import {
  adminSecretMatches,
  buildAdminStatus,
  getAdminSecret,
  setAdminSessionCookie,
} from "../_auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!getAdminSecret()) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured for this deployment." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  const secret = typeof body.secret === "string" ? body.secret : "";

  if (!adminSecretMatches(secret)) {
    return NextResponse.json({ error: "Invalid admin secret." }, { status: 401 });
  }

  const response = NextResponse.json(buildAdminStatus(request, true));
  setAdminSessionCookie(response);
  return response;
}
