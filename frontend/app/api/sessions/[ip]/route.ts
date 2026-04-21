import { NextRequest } from "next/server";
import { proxyToControl } from "@/lib/control";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ip: string }> }
) {
  const { ip } = await params;
  return proxyToControl(`/sessions/${encodeURIComponent(ip)}`, { method: "DELETE" });
}
