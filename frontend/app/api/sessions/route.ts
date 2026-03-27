/**
 * GET  /api/sessions  — list all sessions
 * POST /api/sessions  — create a session
 *
 * These routes proxy to the control API on port 3001.
 * Because the frontend is on port 3000 (whitelisted by the proxy),
 * the iPhone can reach these endpoints even before buying a session.
 */
import { NextRequest, NextResponse } from "next/server";

const CONTROL = "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${CONTROL}/sessions`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${CONTROL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
