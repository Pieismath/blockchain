import { NextRequest, NextResponse } from "next/server";

const CONTROL = "http://localhost:3001";

export async function GET() {
  try {
    const res = await fetch(`${CONTROL}/listings`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${CONTROL}/listings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
