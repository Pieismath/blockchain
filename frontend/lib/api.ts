/**
 * Thin wrapper around the proxy control API (port 3001).
 * All functions return typed promises and throw on non-OK responses.
 */

import type { ProxySession, EarlyExitResult, HotspotListing } from "./types";

/**
 * All API calls use relative /api/* paths so they work from any device
 * (iPhone, desktop) without hardcoding the Mac's IP address.
 * The Next.js API routes in app/api/ proxy these calls to the control API.
 */

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Detect the caller's real IP (used to register the session under the right IP). */
export function getMyIp(): Promise<{ ip: string }> {
  return apiFetch<{ ip: string }>("/api/myip");
}

/** List all proxy sessions (active + expired). */
export function getSessions(): Promise<ProxySession[]> {
  return apiFetch<ProxySession[]>("/api/sessions");
}

/** Activate a new session for the given IP. */
export function createSession(payload: {
  ip: string;
  session_id: string;
  minutes_purchased: number;
  tx_hash: string;
}): Promise<{ session: ProxySession; seconds_granted: number }> {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Terminate a session early and get refund details. */
export function deleteSession(ip: string): Promise<EarlyExitResult> {
  return apiFetch<EarlyExitResult>(`/api/sessions/${encodeURIComponent(ip)}`, {
    method: "DELETE",
  });
}

/** Health check (direct to control API — only used server-side). */
export function getHealth(): Promise<{
  status: string;
  active_sessions: number;
  uptime_seconds: number;
}> {
  return apiFetch("http://localhost:3001/health");
}

/** Fetch all hotspot listings from the control API. */
export function getListings(): Promise<HotspotListing[]> {
  return apiFetch<HotspotListing[]>("/api/listings");
}

/** Register a new hotspot listing. */
export function createListing(payload: {
  name: string;
  ssid: string;
  location: string;
  pricePerMinute: number;
  uploadMbps: number;
  downloadMbps: number;
  signalStrength: number;
  host: string;
  hostIp?: string;
}): Promise<HotspotListing> {
  return apiFetch<HotspotListing>("/api/listings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Remove a listing. */
export function deleteListing(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/listings/${id}`, { method: "DELETE" });
}
