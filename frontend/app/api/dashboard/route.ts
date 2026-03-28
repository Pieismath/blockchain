import { NextResponse } from "next/server";

const CONTROL = "http://localhost:3001";

export async function GET() {
  const res = await fetch(`${CONTROL}/dashboard`, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
