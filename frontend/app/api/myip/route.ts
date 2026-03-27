/**
 * GET /api/myip
 * Returns the caller's real IP address.
 * The proxy sets x-forwarded-for when it forwards iPhone traffic to Next.js,
 * so this correctly reflects the iPhone's IP even when going through the proxy.
 */
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";
  return NextResponse.json({ ip });
}
