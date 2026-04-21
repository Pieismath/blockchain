import { NextResponse } from "next/server";

export const CONTROL_API =
  process.env.CONTROL_API ?? process.env.NEXT_PUBLIC_CONTROL_API ?? "http://localhost:3001";

export async function proxyToControl(
  path: string,
  init?: RequestInit
): Promise<NextResponse> {
  try {
    const res = await fetch(`${CONTROL_API}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "control API unreachable";
    return NextResponse.json(
      { error: "control_api_unreachable", message },
      { status: 502 }
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
