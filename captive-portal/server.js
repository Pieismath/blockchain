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
const https     = require("https");
const { v4: uuidv4 } = require("uuid");
const { execSync, exec } = require("child_process");
const { randomBytes } = require("crypto");
const bs58      = require("bs58");
const dns2      = require("dns2");
const { Packet } = dns2;

// ─── Config ───────────────────────────────────────────────────────────────────

const HTTP_PORT  = 8888;   // pf rdr :80  → :8888
const HTTPS_PORT = 8443;   // pf rdr :443 → :8443
const DNS_PORT  = 5300;   // pf rdr :53  → :5300
const CONTROL_API  = process.env.CONTROL_API  ?? "http://localhost:3001";
const RATE_PER_MIN = parseFloat(process.env.RATE_PER_MIN ?? "0.001"); // SOL per minute

// ─── Solana config ─────────────────────────────────────────────────────────────
const SOLANA_RPC    = process.env.SOLANA_RPC    ?? "https://api.devnet.solana.com";
const SOLANA_WALLET = process.env.SOLANA_WALLET ?? null; // host's wallet (base58)
const SOLANA_RPC_HOST = (() => {
  try {
    return new URL(SOLANA_RPC).hostname;
  } catch {
    return "api.devnet.solana.com";
  }
})();
const DNS_ALLOWLIST = new Set([SOLANA_RPC_HOST]);

// ─── Hotspot config (set by start.sh or env vars) ────────────────────────────
// These are served to the captive portal page via GET /config
const HOTSPOT_CONFIG = {
  name:            process.env.HOTSPOT_NAME     ?? "WiFi Hotspot",
  ssid:            process.env.HOTSPOT_SSID     ?? "⚡HDX-Hotspot",
  listingId:       process.env.HOTSPOT_LISTING_ID ?? "local-hotspot",
  rate:            RATE_PER_MIN,
  currency:        "SOL",
  downloadMbps:    parseInt(process.env.HOTSPOT_DOWN ?? "100"),
  uploadMbps:      parseInt(process.env.HOTSPOT_UP   ?? "50"),
  signalStrength:  parseInt(process.env.HOTSPOT_SIGNAL ?? "4"),
  location:        process.env.HOTSPOT_LOCATION ?? "",
  walletConfigured: !!SOLANA_WALLET,
};

async function fetchMarketplace() {
  try {
    const res = await fetch(`${CONTROL_API}/listings`);
    if (!res.ok) throw new Error(`listing fetch failed: ${res.status}`);
    const listings = await res.json();
    if (Array.isArray(listings) && listings.length > 0) return listings;
  } catch (err) {
    console.warn("[Portal] Could not load listings from control API:", err.message);
  }

  return [
    {
      id: HOTSPOT_CONFIG.listingId,
      name: HOTSPOT_CONFIG.name,
      ssid: HOTSPOT_CONFIG.ssid,
      location: HOTSPOT_CONFIG.location,
      pricePerMinute: HOTSPOT_CONFIG.rate,
      signalStrength: HOTSPOT_CONFIG.signalStrength,
      status: "available",
      host: "local-host",
      hostIp: PORTAL_IP,
      portalUrl: `http://${PORTAL_IP}:${HTTP_PORT}/`,
      uploadMbps: HOTSPOT_CONFIG.uploadMbps,
      downloadMbps: HOTSPOT_CONFIG.downloadMbps,
      hostWallet: SOLANA_WALLET,
      filecoin: {},
      reputation: { reliabilityScore: 100, successfulSessions: 0, refunds: 0, disconnectRate: 0 },
    },
  ];
}

function challengeToSolanaPayUrl(accept) {
  const amountSol = (Number(accept.amount || 0) / 1e9).toFixed(6);
  const params = new URLSearchParams({
    amount: amountSol,
    label: "HotspotDEX",
    message: accept.description || "Hotspot session purchase",
    reference: accept.extra.reference,
    memo: accept.memo || `hotspotdex:${accept.extra.reference}`,
  });
  return `solana:${accept.payTo}?${params.toString()}`;
}

/** Detect the Mac's IP on the shared bridge (Internet Sharing interface). */
function detectPortalIP() {
  const listed = execSync("ifconfig -l 2>/dev/null", { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .filter((iface) => iface.startsWith("bridge"));
  const ordered = ["bridge100", "bridge101", "bridge0", ...listed];

  let fallbackIp = null;

  for (const iface of ordered) {
    try {
      const out = execSync(`ifconfig ${iface} 2>/dev/null`, { encoding: "utf8" });
      const ip = out.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1];
      const status = out.match(/status: (\w+)/)?.[1];
      if (!ip) continue;

      if (!fallbackIp) fallbackIp = ip;
      if (status === "active") {
        console.log(`[Portal] Detected portal IP ${ip} on ${iface} (${status})`);
        return ip;
      }
    } catch {
      // try next interface
    }
  }

  if (fallbackIp) {
    console.warn(`[Portal] No active bridge detected — falling back to ${fallbackIp}`);
    return fallbackIp;
  }

  console.warn("[Portal] Could not detect bridge IP — defaulting to 192.168.2.1");
  return "192.168.2.1";
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

function redirectToPortal(res) {
  res.redirect(302, `http://${PORTAL_IP}/`);
}

// ── Request logger — helps diagnose which probe URLs devices are hitting ───────
app.use((req, res, next) => {
  const ip   = clientIP(req);
  const paid = paidIPs.has(ip) ? "[PAID]" : "[UNPAID]";
  console.log(`[HTTP] ${paid} ${ip} ${req.method} ${req.headers.host || ""}${req.url} UA:${(req.headers["user-agent"] || "").slice(0, 60)}`);
  next();
});

// ── GET /config — serve hotspot info to the payment page ──────────────────────
app.get("/config", (req, res) => {
  res.json({
    ...HOTSPOT_CONFIG,
    rpcHost: SOLANA_RPC_HOST,
  });
});

app.get("/marketplace-data", async (_req, res) => {
  const listings = await fetchMarketplace();
  res.json({ listings });
});

app.get("/wallet-status", (req, res) => {
  res.json({
    walletConfigured: Boolean(SOLANA_WALLET),
    provider: "phantom",
    rpcHost: SOLANA_RPC_HOST,
    connectionMode: "portal-only-rpc-allowlist",
  });
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

  const ip = clientIP(req);
  const minutes = parseInt(req.query.minutes, 10) || 10;
  const listingId = req.query.listingId || HOTSPOT_CONFIG.listingId;

  fetch(`${CONTROL_API}/x402/sessions/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ip,
      listingId,
      minutes,
      tier: "standard",
    }),
  })
    .then(async (challengeRes) => {
      const challenge = await challengeRes.json();
      if (challengeRes.status !== 402) {
        throw new Error(challenge.error || `Unexpected status ${challengeRes.status}`);
      }

      const accept = challenge.accepts?.[0];
      if (!accept) throw new Error("x402 challenge missing payment terms");

      const ref = accept.extra.reference;
      pendingPayments.set(ref, {
        ip,
        minutes,
        listingId,
        created_at: Date.now(),
        activated: false,
      });

      for (const [key, val] of pendingPayments) {
        if (Date.now() - val.created_at > 10 * 60 * 1000) pendingPayments.delete(key);
      }

      console.log(
        `[Portal] x402 challenge: ${ip} ${minutes}min ${accept.amountDisplay} listing=${listingId} ref=${ref.slice(0, 8)}…`
      );
      res.json({
        url: challengeToSolanaPayUrl(accept),
        reference: ref,
        amount: Number(accept.amount || 0) / 1e9,
        minutes,
        listingId,
        challenge,
      });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
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

    const { ip, minutes, listingId } = pending;

    // Open the firewall for this IP
    await pfAdd(ip);

    // Fulfill the same x402 payment challenge the agent flow uses.
    let sessionData;
    try {
      const r = await fetch(`${CONTROL_API}/x402/sessions/purchase`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Payment-Signature": sigInfo.signature,
        },
        body: JSON.stringify({
          ip,
          listingId,
          minutes,
          reference: ref,
          tier: "standard",
        }),
      });
      sessionData = await r.json();
      if (!r.ok) throw new Error(sessionData.error || `HTTP ${r.status}`);
    } catch (error) {
      paidIPs.delete(ip);
      await pfRemove(ip);
      pendingPayments.delete(ref);
      return res.status(500).json({ error: error.message });
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
      paid: true,
      session: sessionData.session,
      seconds_granted: sessionData.session?.seconds_remaining || minutes * 60,
      tx_hash: sigInfo.signature,
      explorer_url:
        sessionData.payment?.explorerUrl ||
        `https://explorer.solana.com/tx/${sigInfo.signature}?cluster=devnet`,
    });

  } catch (err) {
    if (err.name === "FindReferenceError") return res.json({ paid: false });
    console.error("[Portal] payment-status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Captive-portal probe endpoints ────────────────────────────────────────────
//
// These paths are probed by iOS/macOS/Android/Windows immediately after joining
// a new network. We must respond correctly for each OS to trigger the portal:
//
//   • Unpaid → 302 redirect to the payment page  → OS opens captive portal popup
//   • Paid   → 200 "Success" / 204 No Content    → OS considers network open
//
// IMPORTANT: All domains are DNS-resolved to PORTAL_IP, so the Host header
// will differ but the path is what matters.

// Apple (iOS / macOS / tvOS)
// iOS 7-13: http://captive.apple.com/hotspot-detect.html
// iOS 14+ : https://captive.apple.com/hotspot-detect.html  ← hits HTTPS_PORT
// macOS   : same URLs + /library/test/success.html
const APPLE_PROBES = [
  "/hotspot-detect.html",
  "/hotspotdetect.html",
  "/library/test/success.html",
  "/success.html",
  "/canonical.html",
  // Older Apple endpoint (query string is ignored by Express route matching)
  "/bag",
];

function appleProbeResponse(req, res) {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    res.set("Content-Type", "text/html");
    res.send("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  } else {
    // Redirect to portal via port 80 — pf will rdr it to 8888.
    // Using port 80 produces a cleaner URL in the iOS CNA popup browser.
    redirectToPortal(res);
  }
}

app.all(APPLE_PROBES, appleProbeResponse);

// Android (all versions) + Chrome OS
// connectivitycheck.gstatic.com, connectivitycheck.android.com,
// clients3.google.com, play.googleapis.com — all DNS-resolved to PORTAL_IP
app.all(["/generate_204", "/gen_204", "/generate204", "/connectivity-check.html"], (req, res) => {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    res.status(204).send();
  } else {
    redirectToPortal(res);
  }
});

// Windows (NCA — Network Connectivity Assistant)
// http://www.msftconnecttest.com/connecttest.txt  (Windows 10+)
// http://www.msftncsi.com/ncsi.txt               (Windows 7/8)
app.all(["/connecttest.txt", "/ncsi.txt", "/redirect"], (req, res) => {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    res.set("Content-Type", "text/plain");
    res.send("Microsoft Connect Test");
  } else {
    redirectToPortal(res);
  }
});

// Kindle Fire / Amazon devices
app.get(["/kindle-wifi/wifistub.html", "/kindle-wifi/wifiredirect.html"], (req, res) => {
  const ip = clientIP(req);
  if (paidIPs.has(ip)) {
    res.set("Content-Type", "text/html");
    res.send("<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  } else {
    redirectToPortal(res);
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
  const tx_hash    = generateReference();

  try {
    // 1. Open the firewall for this IP
    await pfAdd(ip);

    // 2. Register session with the proxy control API (port 3001)
    const r = await fetch(`${CONTROL_API}/sessions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        ip,
        session_id,
        minutes_purchased: minutes,
        tx_hash,
        listing_id: HOTSPOT_CONFIG.listingId,
      }),
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
app.get("/status", async (req, res) => {
  const ip   = clientIP(req);
  const paid = paidIPs.has(ip);
  if (!paid) return res.json({ ip, paid });

  try {
    const response = await fetch(`${CONTROL_API}/sessions`);
    const sessions = await response.json();
    const session = sessions.find((item) => item.ip === ip && item.active);
    res.json({ ip, paid, session: session || null });
  } catch {
    res.json({ ip, paid });
  }
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

  // Unpaid client — redirect to payment page via port 80 (pf re-intercepts → 8888)
  res.redirect(302, `http://${PORTAL_IP}/`);
});

app.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`[Portal] HTTP server  → port ${HTTP_PORT}`);
  console.log(`[Portal] Portal URL   → http://${PORTAL_IP}:${HTTP_PORT}`);
});

// ── HTTPS server for modern iOS/macOS captive-portal probes ───────────────────
//
// iOS 14+ probes https://captive.apple.com/hotspot-detect.html.
// pf redirects :443 → :8443 (see setup-pf.sh).
//
// We use a self-signed cert. iOS will see a TLS cert mismatch for captive.apple.com
// AND a non-"Success" body/redirect — both are strong captive-portal signals that
// cause CNA to open. The cert warning never surfaces to the user because CNA
// intercepts the request before rendering a page.
//
// Generate the cert once with:
//   openssl req -x509 -newkey rsa:2048 -keyout captive-portal/tls.key \
//     -out captive-portal/tls.crt -days 3650 -nodes \
//     -subj "/CN=captive.apple.com"
//
// If the cert files don't exist the HTTPS server is skipped (HTTP-only fallback).

(function startHttpsServer() {
  const fs = require("fs");
  const keyPath = path.join(__dirname, "tls.key");
  const crtPath = path.join(__dirname, "tls.crt");

  if (!fs.existsSync(keyPath) || !fs.existsSync(crtPath)) {
    console.warn("[Portal] tls.key / tls.crt not found — HTTPS server skipped.");
    console.warn("[Portal] Run: openssl req -x509 -newkey rsa:2048 -keyout captive-portal/tls.key \\");
    console.warn("[Portal]        -out captive-portal/tls.crt -days 3650 -nodes -subj '/CN=captive.apple.com'");
    return;
  }

  const tlsOptions = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(crtPath),
  };

  https.createServer(tlsOptions, app).listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(`[Portal] HTTPS server → port ${HTTPS_PORT}`);
  });
})();

// ─── DNS Server ───────────────────────────────────────────────────────────────
//
// Unpaid clients: resolves ALL domains to PORTAL_IP so iOS captive portal
//                 check (captive.apple.com) hits our HTTP server.
// Paid clients:   forwards DNS queries to upstream (8.8.8.8) so they can
//                 actually browse the internet after paying.
//
// pf redirects UDP :53 → :5300 on the bridge interface, so we don't need root.

const { resolve4 } = require("dns");

function isAllowedUnpaidHostname(name) {
  const hostname = String(name || "").replace(/\.$/, "").toLowerCase();
  for (const allowed of DNS_ALLOWLIST) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

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

    // ── Unpaid client → resolve wallet/RPC hosts normally, everything else to portal ──
    for (const question of request.questions) {
      if (question.type === Packet.TYPE.AAAA) {
        // Return NXDOMAIN-style empty answer for IPv6 to force clients onto IPv4.
        // Without this, devices that get a valid AAAA response may connect via
        // IPv6, bypassing pf redirect rules entirely.
        response.header.rcode = 3; // NXDOMAIN
        console.log(`[DNS] Blocking AAAA for ${question.name} from ${clientIP} → forcing IPv4`);
      } else if (question.type === Packet.TYPE.A && isAllowedUnpaidHostname(question.name)) {
        resolve4(question.name, (err, addresses) => {
          if (!err && addresses && addresses.length) {
            for (const addr of addresses) {
              response.answers.push({
                name: question.name,
                type: Packet.TYPE.A,
                class: Packet.CLASS.IN,
                ttl: 60,
                address: addr,
              });
            }
          } else {
            response.answers.push({
              name: question.name,
              type: Packet.TYPE.A,
              class: Packet.CLASS.IN,
              ttl: 10,
              address: PORTAL_IP,
            });
          }
          send(response);
        });
        return;
      } else {
        response.answers.push({
          name:    question.name,
          type:    Packet.TYPE.A,
          class:   Packet.CLASS.IN,
          ttl:     10,         // short TTL so devices don't cache the intercept
          address: PORTAL_IP,
        });
      }
    }

    send(response);
  },
});

dnsServer.listen({ udp: { port: DNS_PORT, address: "0.0.0.0" } });
console.log(`[Portal] DNS server   → port ${DNS_PORT}`);
console.log(`[Portal] Resolving all domains → ${PORTAL_IP}`);
console.log("");
console.log("Ready. Waiting for iPhone to connect to your Mac hotspot…");
