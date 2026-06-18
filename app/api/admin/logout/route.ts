import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "../_auth";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ authenticated: false });
  clearAdminSessionCookie(response);
  return response;
}
