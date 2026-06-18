import { NextRequest, NextResponse } from "next/server";
import { buildAdminStatus, isAdminAuthenticated } from "../_auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(buildAdminStatus(request, isAdminAuthenticated(request)));
}
