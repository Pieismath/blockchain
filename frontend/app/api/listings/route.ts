import { NextRequest } from "next/server";
import { proxyToControl } from "@/lib/control";

export async function GET() {
  return proxyToControl("/listings");
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxyToControl("/listings", { method: "POST", body });
}
