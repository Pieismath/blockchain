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
const { randomBytes } = require("crypto");
const bs58      = require("bs58");
const dns2      = require("dns2");
const { Packet } = dns2;

// ─── Config ───────────────────────────────────────────────────────────────────

const HTTP_PORT = 8888;   // pf rdr :80  → :8888
const DNS_PORT  = 5300;   // pf rdr :53  → :5300
const CONTROL_API  = process.env.CONTROL_API  ?? "http://localhost:3001";
const RATE_PER_MIN = parseFloat(process.env.RATE_PER_MIN ?? "0.001"); // SOL per minute

// ─── Solana config ─────────────────────────────────────────────────────────────
const SOLANA_RPC    = process.env.SOLANA_RPC    ?? "https://api.devnet.solana.com";
const SOLANA_WALLET = process.env.SOLANA_WALLET ?? null; // host's wallet (base58)

// ─── Hotspot config (set by start.sh or env vars) ────────────────────────────
// These are served to the captive portal page via GET /config
const HOTSPOT_CONFIG = {
  name:            process.env.HOTSPOT_NAME     ?? "WiFi Hotspot",
  ssid:            process.env.HOTSPOT_SSID     ?? "⚡HDX-Hotspot",
  rate:            RATE_PER_MIN,
  currency:        "SOL",
  downloadMbps:    parseInt(process.env.HOTSPOT_DOWN ?? "100"),
  uploadMbps:      parseInt(process.env.HOTSPOT_UP   ?? "50"),
  signalStrength:  parseInt(process.env.HOTSPOT_SIGNAL ?? "4"),
  location:        process.env.HOTSPOT_LOCATION ?? "",
  walletConfigured: !!SOLANA_WALLET,
};

/** Detect the Mac's IP on the shared bridge (Internet Sharing interface). */
function detectPortalIP() {
  for (const iface of ["bridge0", "bridge100", "bridge101", "en0"]) {
    try {
      // Try ipconfig first
      let ip = execSync(`ipconfig getifaddr ${iface} 2>/dev/null`, { encoding: "utf8" }).trim();
      if (ip) { console.log(`[Portal] Detected portal IP ${ip} on ${iface}`); return ip; }
    } catch { /* try next */ }
    try {
      // Fall back to parsing ifconfig (picks up manually-assigned IPs)
      const out = execSync(`ifconfig ${iface} 2>/dev/null`, { encoding: "utf8" });
      const m = out.match(/inet (\d+\.\d+\.\d+\.\d+)/);
      if (m) { console.log(`[Portal] Detected portal IP ${m[1]} on ${iface} (ifconfig)`); return m[1]; }
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

/**
 * Pending Solana Pay sessions waiting for on-chain confirmation.
 * Key: reference pubkey (base58)
 * Value: { ip, minutes, created_at, activated }
 */
const pendingPayments = new Map();

// ─── Solana Pay helpers ───────────────────────────────────────────────────────

/** Generate a random 32-byte base58 public key to use as a Solana Pay reference. */
function generateReference() {
  return bs58.encode(randomBytes(32));
}

/**
 * Poll the Solana RPC for a transaction that includes `referenceBase58`
 * as an account.  Throws { name: "FindReferenceError" } if not found yet.
 */
async function findReferenceOnChain(referenceBase58) {
  const res = await fetch(SOLANA_RPC, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id:      1,
      method:  "getSignaturesForAddress",
      params:  [referenceBase58, { limit: 1, commitment: "confirmed" }],
    }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(error.message);
  if (!result || result.length === 0) {
    const e = new Error("Reference not found");
    e.name = "FindReferenceError";
    throw e;
  }
  return result[0]; // { signature, slot, err, ... }
}

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

// ── GET /config — serve hotspot info to the payment page ──────────────────────
app.get("/config", (req, res) => {
  res.json(HOTSPOT_CONFIG);
});

// ── GET /payment-request?minutes=N ────────────────────────────────────────────
//
// Creates a Solana Pay transfer-request URL with a unique reference key.
// The portal page calls this, then opens the `solana:` deep-link to Phantom.

app.get("/payment-request", (req, res) => {
  if (!SOLANA_WALLET) {
    return res.status(503).json({
      error: "Solana wallet not configured — set the SOLANA_WALLET env var in start.sh.",
    });
  }

  const ip      = clientIP(req);
  const minutes = parseInt(req.query.minutes, 10) || 10;
  const amount  = (RATE_PER_MIN * minutes).toFixed(6); // SOL
  const ref     = generateReference();

  const params = new URLSearchParams({
    amount,
    label:     "HotspotDEX",
    message:   `WiFi — ${HOTSPOT_CONFIG.ssid} — ${minutes} min`,
    reference: ref,
    memo:      `hdx-${minutes}min`,
  });
  const solanaPayUrl = `solana:${SOLANA_WALLET}?${params.toString()}`;

  pendingPayments.set(ref, { ip, minutes, created_at: Date.now(), activated: false });

  // Prune expired entries (> 10 min old)
  for (const [key, val] of pendingPayments) {
    if (Date.now() - val.created_at > 10 * 60 * 1000) pendingPayments.delete(key);
  }

  console.log(`[Portal] Payment request: ${ip} ${minutes}min ${amount} SOL ref=${ref.slice(0, 8)}…`);
  res.json({ url: solanaPayUrl, reference: ref, amount: parseFloat(amount), minutes });
});

// ── GET /payment-status?reference=<base58> ────────────────────────────────────
//
// Portal page polls this after the user approves in Phantom.
// On first confirmed hit: opens the firewall, registers the proxy session.

app.get("/payment-status", async (req, res) => {
  const ref = req.query.reference;
  if (!ref) return res.status(400).json({ error: "reference required" });

  const pending = pendingPayments.get(ref);
  if (!pending) return res.status(404).json({ error: "unknown or expired reference" });

  // Already activated — just confirm
  if (pending.activated) return res.json({ paid: true, already_active: true });

  try {
    const sigInfo = await findReferenceOnChain(ref);

    // Mark activated immediately to prevent double-processing
    pending.activated = true;

    const { ip, minutes } = pending;
    const session_id = uuidv4();

    // Open the firewall for this IP
    await pfAdd(ip);

    // Register with the proxy control API (best-effort)
    let sessionData = { session: { session_id, ip }, seconds_granted: minutes * 60 };
    try {
      const r = await fetch(`${CONTROL_API}/sessions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, session_id, minutes_purchased: minutes, tx_hash: sigInfo.signature }),
      });
      if (r.ok) sessionData = await r.json();
    } catch {
      console.warn("[Portal] Control API unreachable — session tracked locally only");
    }

    paidIPs.add(ip);

    // Auto-expire: close firewall when session ends
    setTimeout(async () => {
      paidIPs.delete(ip);
      await pfRemove(ip);
      pendingPayments.delete(ref);
      console.log(`[Portal] Session expired for ${ip}`);
    }, minutes * 60 * 1000);

    console.log(`[Portal] Payment confirmed ${ip} sig=${sigInfo.signature.slice(0, 10)}…`);
    res.json({
      paid:            true,
      session:         sessionData.session,
      seconds_granted: sessionData.seconds_granted ?? minutes * 60,
    });

  } catch (err) {
    if (err.name === "FindReferenceError") return res.json({ paid: false });
    console.error("[Portal] payment-status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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

// ── Catch-all ────────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  const ip = clientIP(req);

  if (paidIPs.has(ip)) {
    // Paid client hit the portal via pf rdr on port 80 — redirect to HTTPS
    // version of the site they were trying to reach so they can browse normally.
    const host = req.headers.host;
    if (host && !host.startsWith(PORTAL_IP)) {
      return res.redirect(302, `https://${host}${req.url}`);
    }
    // Fallback: return Apple "Success" so CNA closes
    res.set("Content-Type", "text/html");
    return res.send("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  }

  // Unpaid client — redirect to payment page
  res.redirect(302, `http://${PORTAL_IP}:${HTTP_PORT}/`);
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[Portal] HTTP server  → port ${HTTP_PORT}`);
  console.log(`[Portal] Portal URL   → http://${PORTAL_IP}:${HTTP_PORT}`);
});

// ─── DNS Server ───────────────────────────────────────────────────────────────
//
// Unpaid clients: resolves ALL domains to PORTAL_IP so iOS captive portal
//                 check (captive.apple.com) hits our HTTP server.
// Paid clients:   forwards DNS queries to upstream (8.8.8.8) so they can
//                 actually browse the internet after paying.
//
// pf redirects UDP :53 → :5300 on the bridge interface, so we don't need root.

const { resolve4 } = require("dns");

const dnsServer = dns2.createServer({
  udp: true,
  handle: (request, send, rinfo) => {
    const clientIP = (rinfo?.address || "").replace(/^::ffff:/, "");
    const response = Packet.createResponseFromRequest(request);

    // ── Paid client → forward to real DNS ──
    if (paidIPs.has(clientIP)) {
      const question = request.questions[0];
      if (question && question.type === Packet.TYPE.A) {
        resolve4(question.name, (err, addresses) => {
          if (!err && addresses && addresses.length) {
            for (const addr of addresses) {
              response.answers.push({
                name:    question.name,
                type:    Packet.TYPE.A,
                class:   Packet.CLASS.IN,
                ttl:     60,
                address: addr,
              });
            }
          }
          send(response);
        });
        return;
      }
    }

    // ── Unpaid client → resolve everything to portal IP ──
    for (const question of request.questions) {
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
