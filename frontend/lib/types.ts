// ─── Shared type definitions ────────────────────────────────────────────────

/** A hotspot listing shown on the marketplace page. */
export interface HotspotListing {
  id: string;
  name: string;
  ssid?: string;       // WiFi network name the buyer connects to
  location: string;
  pricePerMinute: number;  // ETH
  signalStrength: 1 | 2 | 3 | 4 | 5; // bars
  status: "available" | "occupied";
  host: string; // display handle of host
  hostIp?: string;     // IP of the host's machine running the captive portal
  portalUrl?: string;  // http://[hostIp]:8888/ — captive portal entry point
  uploadMbps: number;
  downloadMbps: number;
}

/** Session record returned by the proxy control API. */
export interface ProxySession {
  ip: string;
  session_id: string;
  paid_until: string;        // ISO date string
  minutes_purchased: number;
  started_at: string;        // ISO date string
  bytes_forwarded: number;
  tx_hash: string | null;
  active: boolean;
  seconds_remaining: number;
}

/** Result of DELETE /sessions/:ip (early exit). */
export interface EarlyExitResult {
  minutes_used: number;
  minutes_remaining: number;
  refund_amount: number;
  session: ProxySession;
}
