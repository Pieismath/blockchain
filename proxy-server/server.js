/**
 * HotspotDEX Proxy Server
 *
 * Two servers run side-by-side:
 *   - Port 8080  — HTTP proxy that buyers configure as their browser/system proxy.
 *                  Every request is checked against the in-memory session store.
 *   - Port 3001  — Control API (Express) used by the frontend to create, list,
 *                  and terminate sessions.
 */

const http = require("http");
const httpProxy = require("http-proxy");
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

// ─── Constants ────────────────────────────────────────────────────────────────

const PROXY_PORT = 8080;
const CONTROL_PORT = 3001;
const RATE_PER_MINUTE = 0.01; // ETH — displayed in 402 responses
const DEMO_WALLET = "0xDEMO_WALLET_ADDRESS_REPLACE_WITH_REAL";

// Detect local IP so the 402 message links to a reachable address on the network
const { execSync } = require("child_process");
function getLocalIP() {
  try {
    return execSync("ipconfig getifaddr en0", { encoding: "utf8" }).trim();
  } catch {
    return "localhost";
  }
}
const LOCAL_IP = getLocalIP();

// Allow ALL requests to the local machine through without a session.
// This covers the payment frontend (port 3000), control API (port 3001),
// and all Next.js static assets (CSS, JS) on any port.
// Only external internet traffic gets blocked until a session is purchased.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", LOCAL_IP]);

function isWhitelisted(url) {
  try {
    const parsed = new URL(url);
    return LOCAL_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

// ─── In-memory session store  { [ip]: SessionRecord } ─────────────────────────
//
// SessionRecord shape:
// {
//   ip:                string   — buyer's IP address (used as key)
//   session_id:        string   — UUID assigned at creation
//   paid_until:        Date     — when the pre-paid time runs out
//   minutes_purchased: number   — how many minutes were bought
//   started_at:        Date     — wall-clock start of the session
//   bytes_forwarded:   number   — running byte count (for future metering)
//   tx_hash:           string   — blockchain tx reference (mock for now)
// }

const sessions = {};

// ─── In-memory listing store ───────────────────────────────────────────────────
// Hosts POST to /listings to advertise their hotspot on the marketplace.
// Shape: { id, name, ssid, location, pricePerMinute, uploadMbps, downloadMbps,
//          signalStrength, host, hostIp, portalUrl, createdAt }
const listings = [];

function normalizeSSID(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const withoutPrefix = trimmed
    .replace(/^\u26a1\s*/u, "")
    .replace(/^HDX[-\s]*/i, "")
    .replace(/^hotspotdex[-\s]*/i, "");

  const slug = withoutPrefix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return slug ? `⚡HDX-${slug}` : "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return true if the session exists and has not expired yet. */
function isActive(ip) {
  const s = sessions[ip];
  return s && new Date() < new Date(s.paid_until);
}

/** Formatted timestamp for console logs. */
function ts() {
  return new Date().toISOString();
}

// ─── Proxy server (port 8080) ─────────────────────────────────────────────────

const proxy = httpProxy.createProxyServer({});

// Log proxy-level errors so the server doesn't crash on broken upstream sockets.
proxy.on("error", (err, req, res) => {
  console.error(`[${ts()}] PROXY ERROR: ${err.message}`);
  if (!res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", message: err.message }));
  }
});

// Track bytes forwarded per session.
proxy.on("proxyRes", (proxyRes, req) => {
  const ip = req.socket.remoteAddress || "unknown";
  if (sessions[ip]) {
    const len = parseInt(proxyRes.headers["content-length"] || "0", 10);
    sessions[ip].bytes_forwarded += len;
  }
});

const proxyServer = http.createServer((req, res) => {
  // Resolve real client IP (handles X-Forwarded-For for local testing).
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const url = req.url || "/";

  if (isActive(ip) || isWhitelisted(url)) {
    // ── ALLOWED ── forward the request to its destination.
    // Whitelisted ports (3000, 3001) always pass so the iPhone can reach
    // the payment page and control API before buying a session.
    const tag = isActive(ip) ? "ALLOWED" : "WHITELISTED";
    console.log(`[${ts()}] ${ip} | ${tag} | ${url}`);
    if (sessions[ip]) sessions[ip].bytes_forwarded = sessions[ip].bytes_forwarded || 0;

    proxy.web(req, res, { target: url, changeOrigin: true });
  } else {
    // ── BLOCKED ── redirect browsers to the marketplace, return JSON for API clients
    console.log(`[${ts()}] ${ip} | BLOCKED | ${url}`);

    const acceptsHtml = (req.headers["accept"] || "").includes("text/html");
    if (acceptsHtml) {
      // Browser request: redirect to captive portal payment page
      const portalUrl = `http://${LOCAL_IP}:8888/`;
      res.writeHead(302, { Location: portalUrl, "Content-Type": "text/html" });
      res.end(`<html><body>Redirecting to <a href="${portalUrl}">HotspotDEX payment</a>…</body></html>`);
    } else {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "payment_required",
          message: `Connect to the ⚡HDX- WiFi network. Payment page pops up automatically.`,
          portal: `http://${LOCAL_IP}:8888/`,
          rate_per_minute: RATE_PER_MINUTE,
        })
      );
    }
  }
});

// Handle HTTP CONNECT (used for HTTPS tunnelling through a proxy).
proxyServer.on("connect", (req, clientSocket, head) => {
  const ip = clientSocket.remoteAddress || "unknown";

  if (isActive(ip)) {
    console.log(`[${ts()}] ${ip} | ALLOWED (CONNECT) | ${req.url}`);
    const [host, port] = req.url.split(":");
    const netModule = require("net");
    const serverSocket = netModule.connect(parseInt(port || "443"), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on("error", (err) => {
      console.error(`[${ts()}] CONNECT tunnel error: ${err.message}`);
      clientSocket.destroy();
    });
  } else {
    console.log(`[${ts()}] ${ip} | BLOCKED (CONNECT) | ${req.url}`);
    // Captive portal trick for HTTPS: accept the tunnel then immediately
    // send an HTTP redirect. Safari on iOS detects this and shows the
    // payment page automatically instead of just showing "Connection failed".
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const redirect =
      `HTTP/1.1 302 Found\r\n` +
      `Location: http://${LOCAL_IP}:3000/marketplace\r\n` +
      `Content-Length: 0\r\n\r\n`;
    clientSocket.end(redirect);
  }
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`[${ts()}] Proxy server listening on port ${PROXY_PORT}`);
});

// ─── Control API (port 3001) ──────────────────────────────────────────────────

const app = express();
app.use(cors()); // allow the Next.js frontend (port 3000) to call us
app.use(express.json());

/**
 * GET /myip
 * Returns the caller's IP address as seen by the server.
 * The frontend calls this so it can register the session under the right IP.
 * x-forwarded-for is set by the proxy when it forwards whitelisted requests.
 */
app.get("/myip", (req, res) => {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";
  res.json({ ip });
});

/**
 * GET /health
 * Quick liveness check — returns proxy status and session count.
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    proxy_port: PROXY_PORT,
    active_sessions: Object.keys(sessions).filter((ip) => isActive(ip)).length,
    total_sessions: Object.keys(sessions).length,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

/**
 * GET /sessions
 * List all sessions (both active and recently expired, so the host dashboard
 * can show history). Active sessions include a `seconds_remaining` field.
 */
app.get("/sessions", (req, res) => {
  const now = new Date();
  const list = Object.values(sessions).map((s) => {
    const paidUntil = new Date(s.paid_until);
    const secondsRemaining = Math.max(0, Math.floor((paidUntil - now) / 1000));
    return {
      ...s,
      active: now < paidUntil,
      seconds_remaining: secondsRemaining,
    };
  });
  res.json(list);
});

/**
 * POST /sessions
 * Activate a session for a buyer IP.
 *
 * Body: { ip, session_id, minutes_purchased, tx_hash }
 *
 * Creates (or overwrites) a session record, setting paid_until to
 * now + minutes_purchased.
 */
app.post("/sessions", (req, res) => {
  const { ip, session_id, minutes_purchased, tx_hash } = req.body;

  if (!ip || !minutes_purchased) {
    return res
      .status(400)
      .json({ error: "ip and minutes_purchased are required" });
  }

  const now = new Date();
  const paidUntil = new Date(now.getTime() + minutes_purchased * 60 * 1000);

  sessions[ip] = {
    ip,
    session_id: session_id || uuidv4(),
    paid_until: paidUntil,
    minutes_purchased: Number(minutes_purchased),
    started_at: now,
    bytes_forwarded: 0,
    tx_hash: tx_hash || null,
  };

  console.log(
    `[${ts()}] SESSION CREATED | ${ip} | ${minutes_purchased} min | tx: ${tx_hash}`
  );

  res.status(201).json({
    message: "Session activated",
    session: sessions[ip],
    seconds_granted: minutes_purchased * 60,
  });
});

/**
 * DELETE /sessions/:ip
 * Early-exit: end the session before paid_until, calculate what was used,
 * return refund information (the frontend / smart contract will handle the
 * actual on-chain refund).
 *
 * Response: { minutes_used, minutes_remaining, refund_amount, session }
 */
app.delete("/sessions/:ip", (req, res) => {
  // URL-encode can turn dots into %2E — decode it.
  const ip = decodeURIComponent(req.params.ip);

  if (!sessions[ip]) {
    return res.status(404).json({ error: "Session not found for IP: " + ip });
  }

  const session = sessions[ip];
  const now = new Date();
  const startedAt = new Date(session.started_at);
  const elapsedMs = now - startedAt;
  const minutesUsed = Math.ceil(elapsedMs / 60000); // round up — host keeps partial minutes
  const minutesRemaining = Math.max(
    0,
    session.minutes_purchased - minutesUsed
  );
  const refundAmount = minutesRemaining * RATE_PER_MINUTE;

  console.log(
    `[${ts()}] EARLY EXIT | ${ip} | used: ${minutesUsed} min | refund: ${refundAmount} ETH`
  );

  // Mark session as expired immediately.
  session.paid_until = now;

  res.json({
    minutes_used: minutesUsed,
    minutes_remaining: minutesRemaining,
    refund_amount: refundAmount,
    session,
  });
});

// ─── Listings API ─────────────────────────────────────────────────────────────

/** GET /listings — return all registered hotspot listings */
app.get("/listings", (req, res) => {
  res.json(listings);
});

/** POST /listings — register a new hotspot */
app.post("/listings", (req, res) => {
  const { name, ssid, location, pricePerMinute, uploadMbps, downloadMbps, signalStrength, host, hostIp } = req.body;
  const normalizedSsid = normalizeSSID(ssid || name);

  if (!name || !normalizedSsid || !pricePerMinute) {
    return res.status(400).json({ error: "name, ssid, and pricePerMinute are required" });
  }
  const id = "hs-" + Date.now();
  const ip = hostIp || LOCAL_IP;
  const listing = {
    id,
    name,
    ssid: normalizedSsid,
    location: location || "Unknown location",
    pricePerMinute: Number(pricePerMinute),
    uploadMbps: Number(uploadMbps) || 50,
    downloadMbps: Number(downloadMbps) || 100,
    signalStrength: Number(signalStrength) || 4,
    host: host || "anonymous",
    hostIp: ip,
    portalUrl: `http://${ip}:8888/`,
    status: "available",
    createdAt: new Date().toISOString(),
  };
  listings.push(listing);
  console.log(`[${ts()}] LISTING CREATED | ${name} | SSID: ${normalizedSsid} | ${pricePerMinute} ETH/min`);
  res.status(201).json(listing);
});

/** DELETE /listings/:id — remove a listing */
app.delete("/listings/:id", (req, res) => {
  const idx = listings.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Listing not found" });
  listings.splice(idx, 1);
  res.json({ ok: true });
});

app.listen(CONTROL_PORT, () => {
  console.log(`[${ts()}] Control API listening on port ${CONTROL_PORT}`);
});
