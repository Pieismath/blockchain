/**
 * HotspotDEX Captive Portal Server
 *
 * Runs two services:
 *   Port 5300 — DNS server (pf redirects :53 → here)
 *               Resolves ALL domains to PORTAL_IP so iOS captive portal
 *               check (captive.apple.com) hits our HTTP server.
 *
 *   Port 8888 — HTTP portal server (pf redirects :80 → here)
 *               • Detects Apple/Android captive-portal probes
 *               • Serves the mobile payment page
 *               • POST /activate  — creates session + opens firewall for IP
 *               • POST /disconnect — closes session + closes firewall for IP
 *
 * Firewall management:
 *   Uses macOS pf with a persistent table <allowed_clients>.
 *   After payment: sudo pfctl -t allowed_clients -T add <ip>
 *   On disconnect:  sudo pfctl -t allowed_clients -T delete <ip>
 *
 * Prerequisites (one-time):
 *   1. Enable Internet Sharing on your Mac (Settings → General → Sharing)
 *   2. Run: sudo ./setup-pf.sh
 * Then:
 *   node server.js  (no sudo needed — pf handles the port redirects)
 */

"use strict";

const express   = require("express");
const cors      = require("cors");
const path      = require("path");
const { v4: uuidv4 } = require("uuid");
const { execSync, exec } = require("child_process");
const dns2      = require("dns2");
const { Packet } = dns2;

// ─── Config ───────────────────────────────────────────────────────────────────

const HTTP_PORT    = 8888;   // pf rdr :80  → :8888
const DNS_PORT     = 5300;   // pf rdr :53  → :5300
const CONTROL_API  = process.env.CONTROL_API  ?? "http://localhost:3001";
const RATE_PER_MIN = 0.01;   // ETH per minute (display only — mock payment)

/** Detect the Mac's IP on the shared bridge (Internet Sharing interface). */
function detectPortalIP() {
  for (const iface of ["bridge100", "bridge101", "en0"]) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { encoding: "utf8" }).trim();
      if (ip) { console.log(`[Portal] Detected portal IP ${ip} on ${iface}`); return ip; }
    } catch { /* try next */ }
  }
  console.warn("[Portal] Could not detect bridge IP — defaulting to 192.168.3.1");
  return "192.168.3.1";
}

const PORTAL_IP = process.env.PORTAL_IP ?? detectPortalIP();

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Set of IPs that have an active paid session.
 * Used to return "Success" to Apple's captive-portal probe so iOS
 * automatically closes the CNA after payment.
 */
const paidIPs = new Set();

// ─── Firewall helpers (pfctl) ─────────────────────────────────────────────────

function pfAdd(ip) {
  return new Promise((resolve, reject) => {
    exec(`sudo pfctl -t allowed_clients -T add ${ip}`, (err, _, stderr) => {
      if (err) {
        console.error(`[pf] WARN: could not add ${ip} — ${stderr.trim()}`);
        // Don't hard-fail; session is still tracked in memory
        resolve();
      } else {
        console.log(`[pf] Opened firewall for ${ip}`);
        resolve();
      }
    });
  });
}

function pfRemove(ip) {
  return new Promise((resolve) => {
    exec(`sudo pfctl -t allowed_clients -T delete ${ip}`, (err, _, stderr) => {
      if (err) console.error(`[pf] WARN: could not remove ${ip} — ${stderr.trim()}`);
      else console.log(`[pf] Closed firewall for ${ip}`);
      resolve();
    });
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * Extract real client IP, stripping IPv4-mapped IPv6 prefix (::ffff:).
 */
function clientIP(req) {
  const raw = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  return raw.split(",")[0].trim().replace(/^::ffff:/, "");
}

// ── Apple captive-portal detection endpoints ──────────────────────────────────
//
// iOS makes a GET to one of these after connecting to a new network.
// Expected response for an OPEN network: 200 with body "Success".
// Anything else (redirect, wrong body) → iOS opens the CNA popup.

const APPLE_PROBES = [
  "/hotspot-detect.html",
  "/library/test/success.html",
  "/success.html",
  "/hotspotdetect.html",
];

app.get(APPLE_PROBES, (req, res) => {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    // Tell iOS the network is open → CNA closes automatically
    res.set("Content-Type", "text/html");
    res.send("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  } else {
    // Redirect to payment page → iOS opens CNA showing our page
    res.redirect(302, `http://${PORTAL_IP}:${HTTP_PORT}/`);
  }
});

// ── Android captive-portal detection ─────────────────────────────────────────
app.get(["/generate_204", "/gen_204"], (req, res) => {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    res.status(204).send();
  } else {
    res.redirect(302, `http://${PORTAL_IP}:${HTTP_PORT}/`);
  }
});

// ── POST /activate ────────────────────────────────────────────────────────────
//
// Called by the payment page JS when the user taps "Pay & Connect".
// Body: { minutes: number }

app.post("/activate", async (req, res) => {
  const ip      = clientIP(req);
  const minutes = parseInt(req.body?.minutes, 10);

  if (!minutes || minutes < 1) {
    return res.status(400).json({ error: "minutes must be a positive integer" });
  }

  const session_id = uuidv4();
  const tx_hash    = "0x" + Array.from({ length: 64 },
    () => Math.floor(Math.random() * 16).toString(16)).join("");

  try {
    // 1. Open the firewall for this IP
    await pfAdd(ip);

    // 2. Register session with the proxy control API (port 3001)
    const r = await fetch(`${CONTROL_API}/sessions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ip, session_id, minutes_purchased: minutes, tx_hash }),
    });
    if (!r.ok) throw new Error(`Control API: HTTP ${r.status}`);
    const data = await r.json();

    // 3. Mark IP as paid (so Apple probe returns "Success")
    paidIPs.add(ip);

    // 4. Auto-expire: close firewall when session time runs out
    setTimeout(async () => {
      paidIPs.delete(ip);
      await pfRemove(ip);
      console.log(`[Portal] Session expired for ${ip}`);
    }, minutes * 60 * 1000);

    console.log(`[Portal] Activated ${minutes} min session for ${ip} (tx: ${tx_hash.slice(0, 10)}…)`);
    res.json({ ok: true, session: data.session, seconds_granted: data.seconds_granted });

  } catch (err) {
    console.error(`[Portal] Activate failed for ${ip}:`, err.message);
    // Roll back firewall if we opened it
    paidIPs.delete(ip);
    await pfRemove(ip);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /disconnect ──────────────────────────────────────────────────────────
app.post("/disconnect", async (req, res) => {
  const ip = clientIP(req);
  paidIPs.delete(ip);
  await pfRemove(ip);

  try {
    const r    = await fetch(`${CONTROL_API}/sessions/${encodeURIComponent(ip)}`, { method: "DELETE" });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────
// Payment page polls this to check if its IP is currently paid.
app.get("/status", (req, res) => {
  const ip   = clientIP(req);
  const paid = paidIPs.has(ip);
  res.json({ ip, paid });
});

// ── Catch-all redirect to payment page ───────────────────────────────────────
app.get("*", (req, res) => {
  res.redirect(302, `http://${PORTAL_IP}:${HTTP_PORT}/`);
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[Portal] HTTP server  → port ${HTTP_PORT}`);
  console.log(`[Portal] Portal URL   → http://${PORTAL_IP}:${HTTP_PORT}`);
});

// ─── DNS Server ───────────────────────────────────────────────────────────────
//
// Responds to ALL DNS queries with PORTAL_IP.
// This intercepts iOS's lookup of captive.apple.com (and everything else)
// so all HTTP traffic ends up at our portal server.
//
// pf redirects UDP :53 → :5300 on the bridge interface, so we don't need root.

const dnsServer = dns2.createServer({
  udp: true,
  handle: (request, send) => {
    const response = Packet.createResponseFromRequest(request);

    for (const question of request.questions) {
      // A record: always return the portal IP
      response.answers.push({
        name:    question.name,
        type:    Packet.TYPE.A,
        class:   Packet.CLASS.IN,
        ttl:     10,         // short TTL so devices don't cache the intercept
        address: PORTAL_IP,
      });
    }

    send(response);
  },
});

dnsServer.listen({ udp: { port: DNS_PORT, address: "0.0.0.0" } });
console.log(`[Portal] DNS server   → port ${DNS_PORT}`);
console.log(`[Portal] Resolving all domains → ${PORTAL_IP}`);
console.log("");
console.log("Ready. Waiting for iPhone to connect to your Mac hotspot…");
