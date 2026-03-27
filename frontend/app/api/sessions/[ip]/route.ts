/**
 * DELETE /api/sessions/:ip — early exit, returns refund info
 * Proxies to the control API on port 3001.
 */
import { NextRequest, NextResponse } from "next/server";

const CONTROL = "http://localhost:3001";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ip: string }> }
) {
  const { ip } = await params;
  const res = await fetch(`${CONTROL}/sessions/${encodeURIComponent(ip)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
