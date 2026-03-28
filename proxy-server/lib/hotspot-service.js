"use strict";

const crypto = require("crypto");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const { createArtifactStore } = require("./artifacts");
const {
  LAMPORTS_PER_SOL,
  formatSol,
  generateReference,
  normalizeWallet,
  sendSolanaRefund,
  verifySolanaPayment,
} = require("./solana");

function normalizeIp(value) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "") || "127.0.0.1";
}

function redactIdentifier(value) {
  if (!value) return "anonymous";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function normalizeSSID(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const withoutPrefix = trimmed
    .replace(/^\u26a1\s*/u, "")
    .replace(/^Netra[-\s]*/i, "")
    .replace(/^HDX[-\s]*/i, "")
    .replace(/^hotspotdex[-\s]*/i, "");

  const slug = withoutPrefix.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return slug ? `⚡Netra-${slug}` : "";
}

function sortNewestFirst(items, key = "createdAt") {
  return [...items].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}

const DEMO_HOTSPOTS = [
  {
    id: "demo-fishtown-commons",
    name: "Fishtown Commons",
    ssid: "⚡Netra-Fishtown",
    location: "Philadelphia, PA · Fishtown",
    pricePerMinute: 0.001,
    signalStrength: 5,
    uploadMbps: 45,
    downloadMbps: 180,
    host: "demo-host-fishtown",
    demo: true,
    durationOptions: [5, 10, 30],
  },
  {
    id: "demo-old-city-relay",
    name: "Old City Relay",
    ssid: "⚡Netra-OldCity",
    location: "Philadelphia, PA · Old City",
    pricePerMinute: 0.0008,
    signalStrength: 4,
    uploadMbps: 30,
    downloadMbps: 120,
    host: "demo-host-oldcity",
    demo: true,
    durationOptions: [10, 20, 30],
  },
  {
    id: "demo-university-city-mesh",
    name: "University City Mesh",
    ssid: "⚡Netra-UCity",
    location: "Philadelphia, PA · University City",
    pricePerMinute: 0.0012,
    signalStrength: 3,
    uploadMbps: 28,
    downloadMbps: 90,
    host: "demo-host-ucity",
    demo: true,
    durationOptions: [5, 15, 30],
  },
  {
    id: "demo-riverfront-ap",
    name: "Riverfront AP",
    ssid: "⚡Netra-Riverfront",
    location: "Philadelphia, PA · Penn's Landing",
    pricePerMinute: 0.0006,
    signalStrength: 4,
    uploadMbps: 32,
    downloadMbps: 110,
    host: "demo-host-riverfront",
    demo: true,
    durationOptions: [5, 10, 20],
  },
];

function createHotspotService({
  dataDir,
  verifyPayment = verifySolanaPayment,
  sendRefund = sendSolanaRefund,
  now = () => Date.now(),
  localIp = "localhost",
  hostWallet = process.env.SOLANA_WALLET || null,
  ratePerMinute = Number(process.env.RATE_PER_MIN || 0.001),
  portalPort = Number(process.env.PORTAL_PORT || 8888),
}) {
  const artifactStore = createArtifactStore({ dataDir });
  const sessionsPath = path.join(dataDir, "sessions.json");
  const listingsPath = path.join(dataDir, "listings.json");
  const intentsPath = path.join(dataDir, "payment-intents.json");

  const state = {
    sessions: artifactStore.readJson(sessionsPath, []),
    listings: artifactStore.readJson(listingsPath, []),
    intents: artifactStore.readJson(intentsPath, []),
  };

  function persist() {
    artifactStore.writeJson(sessionsPath, state.sessions);
    artifactStore.writeJson(listingsPath, state.listings);
    artifactStore.writeJson(intentsPath, state.intents);
  }

  function ts(value = now()) {
    return new Date(value).toISOString();
  }

  function getActiveSessionForIp(ip) {
    return state.sessions.find(
      (session) =>
        session.ip === ip &&
        session.status === "active" &&
        new Date(session.paid_until).getTime() > now()
    );
  }

  function pickListing(listingId) {
    const direct = state.listings.find((listing) => listing.id === listingId);
    if (direct) return direct;
    return state.listings[0] || createDefaultListing();
  }

  function createDefaultListing() {
    const existing = state.listings.find((listing) => listing.id === "local-hotspot");
    if (existing) return existing;

    const listing = {
      id: "local-hotspot",
      name: process.env.HOTSPOT_NAME || "Netra Test Account",
      ssid: normalizeSSID(process.env.HOTSPOT_SSID || "Netra Test Account"),
      location: process.env.HOTSPOT_LOCATION || "Philadelphia, PA · Demo hotspot",
      pricePerMinute: ratePerMinute,
      signalStrength: Number(process.env.HOTSPOT_SIGNAL || 4),
      status: "available",
      host: process.env.HOST_HANDLE || "Netra Test Account",
      hostWallet: normalizeWallet(hostWallet),
      hostIp: localIp,
      portalUrl: `http://${localIp}:${portalPort}/`,
      uploadMbps: Number(process.env.HOTSPOT_UP || 50),
      downloadMbps: Number(process.env.HOTSPOT_DOWN || 100),
      durationOptions: [5, 10, 30],
      demo: false,
      real: true,
      policies: {
        noInternetUntilPaid: true,
        refundWindowSeconds: Number(process.env.HOTSPOT_REFUND_WINDOW || 30),
        sessionTypeSupport: ["human", "agent"],
      },
      filecoin: {},
      createdAt: ts(),
      updatedAt: ts(),
    };

    state.listings.unshift(listing);
    persist();
    return listing;
  }

  function ensureDemoListings() {
    for (const demo of DEMO_HOTSPOTS) {
      const existing = state.listings.find((listing) => listing.id === demo.id);
      if (existing) {
        existing.demo = true;
        existing.durationOptions = demo.durationOptions;
        continue;
      }

      state.listings.push({
        ...demo,
        ssid: normalizeSSID(demo.ssid || demo.name),
        status: "available",
        hostWallet: normalizeWallet(hostWallet),
        hostIp: localIp,
        portalUrl: `http://${localIp}:${portalPort}/`,
        policies: {
          noInternetUntilPaid: true,
          refundWindowSeconds: Number(process.env.HOTSPOT_REFUND_WINDOW || 30),
          sessionTypeSupport: ["human", "agent"],
          agentAccess: true,
        },
        filecoin: {},
        real: false,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }

    persist();
  }

  function addTransition(session, status, metadata = {}) {
    session.status = status;
    session.status_transitions.push({
      status,
      at: ts(),
      metadata,
    });
  }

  async function refreshListingArtifacts(listing) {
    const related = state.sessions.filter((session) => session.listing_id === listing.id);
    const completed = related.filter((session) => ["expired", "disconnected", "refunded"].includes(session.status));
    const refunded = related.filter((session) => session.status === "refunded");
    const uptimeScore = completed.length
      ? Math.max(0, 100 - Math.round((refunded.length / completed.length) * 100))
      : 100;

    const profilePayload = {
      listingId: listing.id,
      name: listing.name,
      ssid: listing.ssid,
      location: listing.location,
      pricing: {
        ratePerMinuteSol: listing.pricePerMinute,
      },
      policies: listing.policies,
      aggregateUsage: {
        totalSessions: related.length,
        activeSessions: related.filter((session) => session.status === "active").length,
        completedSessions: completed.length,
        bytesForwarded: related.reduce((sum, session) => sum + (session.bytes_forwarded || 0), 0),
      },
      updatedAt: ts(),
    };

    const reputationPayload = {
      listingId: listing.id,
      hostWallet: listing.hostWallet,
      successfulSessions: completed.length - refunded.length,
      refunds: refunded.length,
      disconnectRate: completed.length ? refunded.length / completed.length : 0,
      slaFailures: refunded.length,
      reliabilityScore: uptimeScore,
      updatedAt: ts(),
    };

    const profileArtifact = await artifactStore.persist("host-profile", profilePayload, {
      listingId: listing.id,
      scope: "profile",
    });
    const reputationArtifact = await artifactStore.persist("reputation", reputationPayload, {
      listingId: listing.id,
      scope: "reputation",
    });

    listing.filecoin = {
      latestProfileCid: profileArtifact.cid,
      latestReputationCid: reputationArtifact.cid,
      synapse: reputationArtifact.synapse,
    };
    listing.reputation = {
      reliabilityScore: uptimeScore,
      successfulSessions: reputationPayload.successfulSessions,
      refunds: reputationPayload.refunds,
      disconnectRate: reputationPayload.disconnectRate,
    };
    listing.updatedAt = ts();
  }

  async function persistSessionArtifact(session, artifactKind, extra = {}) {
    const payload = {
      artifactKind,
      sessionId: session.session_id,
      listingId: session.listing_id,
      hostId: session.host_id,
      hostWallet: session.host_wallet,
      buyer: {
        redactedIp: redactIdentifier(session.ip),
        redactedWallet: redactIdentifier(session.buyer_wallet),
        sessionType: session.session_type,
      },
      time: {
        startedAt: session.started_at,
        paidUntil: session.paid_until,
        endedAt: session.ended_at || null,
      },
      usage: {
        minutesPurchased: session.minutes_purchased,
        minutesUsed: session.minutes_used || 0,
        bytesForwarded: session.bytes_forwarded || 0,
      },
      payment: {
        txHash: session.tx_hash,
        reference: session.payment_reference,
        amountSol: session.amount_sol,
        amountLamports: session.amount_lamports,
        explorerUrl: session.payment_explorer_url,
        source: session.payment_source,
      },
      refund: session.refund || null,
      status: session.status,
      statusTransitions: session.status_transitions,
      extra,
      generatedAt: ts(),
    };

    const artifact = await artifactStore.persist(artifactKind, payload, {
      sessionId: session.session_id,
      listingId: session.listing_id,
    });

    session.filecoin.latestCid = artifact.cid;
    session.filecoin.artifacts.push(artifact);
    return artifact;
  }

  async function upsertListing(input) {
    const normalized = {
      id: input.id || `hs-${Date.now()}`,
      name: input.name,
      ssid: normalizeSSID(input.ssid || input.name),
      location: input.location || "Unknown location",
      pricePerMinute: Number(input.pricePerMinute || ratePerMinute),
      signalStrength: Number(input.signalStrength || 4),
      status: "available",
      host: input.host || "host",
      hostWallet: normalizeWallet(input.hostWallet || hostWallet),
      hostIp: input.hostIp || localIp,
      portalUrl: input.portalUrl || `http://${input.hostIp || localIp}:${portalPort}/`,
      uploadMbps: Number(input.uploadMbps || 50),
      downloadMbps: Number(input.downloadMbps || 100),
      durationOptions: Array.isArray(input.durationOptions) && input.durationOptions.length
        ? input.durationOptions.map((value) => Number(value)).filter(Boolean)
        : [5, 10, 30],
      demo: Boolean(input.demo),
      policies: {
        noInternetUntilPaid: true,
        refundWindowSeconds: Number(input.refundWindowSeconds || process.env.HOTSPOT_REFUND_WINDOW || 30),
        agentAccess: true,
      },
      filecoin: input.filecoin || {},
      createdAt: input.createdAt || ts(),
      updatedAt: ts(),
    };

    const index = state.listings.findIndex((listing) => listing.id === normalized.id);
    let storedListing = normalized;
    if (index >= 0) {
      state.listings[index] = { ...state.listings[index], ...normalized };
      storedListing = state.listings[index];
    } else {
      state.listings.unshift(normalized);
      storedListing = normalized;
    }

    await refreshListingArtifacts(storedListing);
    persist();
    return storedListing;
  }

  async function createSession({
    ip,
    minutes,
    txHash,
    paymentReference,
    paymentSource,
    paymentExplorerUrl,
    listingId,
    sessionType,
    buyerWallet,
    tier = "standard",
    source = "captive-portal",
  }) {
    const cleanIp = normalizeIp(ip);
    const listing = pickListing(listingId);
    const start = now();
    const paidUntil = start + Number(minutes) * 60 * 1000;
    const amountLamports = Math.round(
      Number(listing.pricePerMinute || ratePerMinute) * Number(minutes) * LAMPORTS_PER_SOL
    );

    const existing = getActiveSessionForIp(cleanIp);
    if (existing) {
      existing.minutes_purchased += Number(minutes);
      existing.paid_until = ts(new Date(existing.paid_until).getTime() + Number(minutes) * 60 * 1000);
      existing.amount_lamports += amountLamports;
      existing.amount_sol = formatSol(existing.amount_lamports);
      existing.tx_hash = txHash || existing.tx_hash;
      existing.payment_reference = paymentReference || existing.payment_reference;
      existing.payment_explorer_url = paymentExplorerUrl || existing.payment_explorer_url;
      addTransition(existing, "active", {
        reason: "extended",
        addedMinutes: Number(minutes),
        source,
      });
      await persistSessionArtifact(existing, "session-extension", { addedMinutes: Number(minutes) });
      await refreshListingArtifacts(listing);
      persist();
      return existing;
    }

    const session = {
      ip: cleanIp,
      session_id: uuidv4(),
      listing_id: listing.id,
      host_id: listing.id,
      host_wallet: listing.hostWallet,
      session_type: sessionType,
      tier,
      entrypoint: source,
      started_at: ts(start),
      paid_until: ts(paidUntil),
      ended_at: null,
      minutes_purchased: Number(minutes),
      minutes_used: 0,
      bytes_forwarded: 0,
      tx_hash: txHash || null,
      payment_reference: paymentReference || null,
      payment_source: paymentSource,
      payment_explorer_url: paymentExplorerUrl || null,
      buyer_wallet: buyerWallet || null,
      amount_lamports: amountLamports,
      amount_sol: formatSol(amountLamports),
      status: "payment_pending",
      status_transitions: [],
      refund: null,
      filecoin: {
        latestCid: null,
        artifacts: [],
      },
      createdAt: ts(start),
      updatedAt: ts(start),
    };

    addTransition(session, "paid", {
      source,
      txHash: txHash || null,
    });
    addTransition(session, "active", {
      source,
      sessionType,
    });

    state.sessions.unshift(session);
    await persistSessionArtifact(session, "session-receipt", { source });
    await refreshListingArtifacts(listing);
    persist();
    return session;
  }

  function buildIntent({ ip, minutes, listingId, buyerWallet, tier, action, sessionId }) {
    if (!minutes || Number(minutes) <= 0) {
      throw new Error("minutes must be a positive number");
    }
    const listing = pickListing(listingId);
    const wallet = normalizeWallet(listing.hostWallet || hostWallet);
    if (!wallet) {
      throw new Error("SOLANA_WALLET or listing host wallet must be configured");
    }

    const amountLamports = Math.round(
      Number(listing.pricePerMinute || ratePerMinute) * Number(minutes) * LAMPORTS_PER_SOL
    );
    const reference = generateReference();
    const intent = {
      id: `intent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      action,
      sessionId: sessionId || null,
      ip: normalizeIp(ip),
      listingId: listing.id,
      buyerWallet: buyerWallet || null,
      tier: tier || "standard",
      minutes: Number(minutes),
      amountLamports,
      amountSol: formatSol(amountLamports),
      reference,
      payTo: wallet,
      createdAt: ts(),
      expiresAt: ts(now() + 15 * 60 * 1000),
      status: "pending",
    };

    state.intents.unshift(intent);
    persist();
    return intent;
  }

  function buildX402Challenge(intent, resource, description) {
    return {
      x402Version: 1,
      error: "payment_required",
      message: "Pay on Solana devnet to unlock hotspot access.",
      accepts: [
        {
          scheme: "exact",
          network: "solana-devnet",
          asset: "SOL",
          amount: String(intent.amountLamports),
          amountDisplay: `${intent.amountSol.toFixed(6)} SOL`,
          payTo: intent.payTo,
          resource,
          description,
          memo: `netra:${intent.reference}`,
          extra: {
            reference: intent.reference,
            listingId: intent.listingId,
            minutes: intent.minutes,
            action: intent.action,
            sessionId: intent.sessionId,
            tier: intent.tier,
          },
        },
      ],
      paymentContext: {
        reference: intent.reference,
        expiresAt: intent.expiresAt,
        retryHeader: "Payment-Signature",
      },
    };
  }

  function listSessions() {
    const current = now();
    return sortNewestFirst(
      state.sessions.map((session) => {
        const paidUntil = new Date(session.paid_until).getTime();
        const active = session.status === "active" && paidUntil > current;
        return {
          ...session,
          active,
          seconds_remaining: active ? Math.max(0, Math.floor((paidUntil - current) / 1000)) : 0,
        };
      }),
      "started_at"
    );
  }

  async function expireSessions() {
    const current = now();
    const expired = state.sessions.filter(
      (session) =>
        session.status === "active" &&
        new Date(session.paid_until).getTime() <= current
    );

    if (expired.length === 0) return;

    for (const session of expired) {
      session.ended_at = ts(current);
      session.minutes_used = session.minutes_purchased;
      addTransition(session, "expired", { reason: "time_elapsed" });
      await persistSessionArtifact(session, "session-closeout", { reason: "expired" });
      const listing = pickListing(session.listing_id);
      await refreshListingArtifacts(listing);
    }

    persist();
  }

  async function disconnectSessionByIp(ip, reason = "manual_disconnect") {
    const cleanIp = normalizeIp(ip);
    const session = state.sessions.find(
      (item) => item.ip === cleanIp && ["active", "paid"].includes(item.status)
    );

    if (!session) return null;

    const elapsedMs = Math.max(0, now() - new Date(session.started_at).getTime());
    const purchasedMs = Math.max(1, Number(session.minutes_purchased || 0) * 60 * 1000);
    const clampedElapsedMs = Math.min(elapsedMs, purchasedMs);
    const totalLamports = Math.max(
      0,
      Number(session.amount_lamports || 0) ||
        Math.round(
          Number(session.minutes_purchased || 0) *
            Number(pickListing(session.listing_id).pricePerMinute || ratePerMinute) *
            LAMPORTS_PER_SOL
        )
    );
    const usedLamports = Math.min(
      totalLamports,
      Math.round((clampedElapsedMs / purchasedMs) * totalLamports)
    );
    const refundLamports = Math.max(0, totalLamports - usedLamports);
    const minutesUsed = Number((clampedElapsedMs / 60000).toFixed(2));
    const minutesRemaining = Number(
      Math.max(0, (purchasedMs - clampedElapsedMs) / 60000).toFixed(2)
    );
    let refundResult = {
      status: refundLamports > 0 ? "pending_config" : "not_needed",
      signature: null,
      explorerUrl: null,
      sourceWallet: null,
      error: null,
    };

    if (refundLamports > 0) {
      try {
        refundResult = {
          ...refundResult,
          ...(await sendRefund({
            destination: session.buyer_wallet,
            amountLamports: refundLamports,
            memo: `netra-refund:${session.session_id}`,
          })),
        };
      } catch (error) {
        refundResult = {
          ...refundResult,
          status: "failed",
          error: error.message,
        };
      }
    }

    session.minutes_used = minutesUsed;
    session.ended_at = ts();
    session.paid_until = ts(now());
    session.refund = {
      amountLamports: refundLamports,
      amountSol: formatSol(refundLamports),
      minutesRemaining,
      reason,
      status: refundResult.status,
      txHash: refundResult.signature || null,
      explorerUrl: refundResult.explorerUrl || null,
      sourceWallet: refundResult.sourceWallet || null,
      error: refundResult.error || null,
    };
    const refundCompleted = refundLamports > 0 && refundResult.status === "sent";
    addTransition(session, refundCompleted ? "refunded" : "disconnected", {
      reason,
      minutesUsed,
      minutesRemaining,
      refundStatus: refundResult.status,
      refundTxHash: refundResult.signature || null,
    });

    await persistSessionArtifact(session, "session-closeout", {
      reason,
      minutesUsed,
      minutesRemaining,
      refundStatus: refundResult.status,
    });
    await refreshListingArtifacts(pickListing(session.listing_id));
    persist();

    return {
      minutes_used: minutesUsed,
      minutes_remaining: minutesRemaining,
      refund_amount: formatSol(refundLamports),
      refund_lamports: refundLamports,
      refund_status: refundResult.status,
      refund_tx_hash: refundResult.signature || null,
      refund_explorer_url: refundResult.explorerUrl || null,
      refund_error: refundResult.error || null,
      session,
    };
  }

  function recordForwardedBytes(ip, bytes) {
    const cleanIp = normalizeIp(ip);
    const session = getActiveSessionForIp(cleanIp);
    if (!session) return;
    session.bytes_forwarded += Number(bytes || 0);
    session.updatedAt = ts();
  }

  function removeListing(id) {
    const index = state.listings.findIndex((listing) => listing.id === id);
    if (index < 0) return false;
    state.listings.splice(index, 1);
    persist();
    return true;
  }

  function pruneIntents() {
    const current = now();
    const before = state.intents.length;
    state.intents = state.intents.filter((intent) => new Date(intent.expiresAt).getTime() > current);
    if (state.intents.length !== before) persist();
  }

  async function fulfillIntent({ reference, signature, buyerWallet }) {
    pruneIntents();
    const intent = state.intents.find((candidate) => candidate.reference === reference);
    if (!intent) {
      throw new Error("Unknown or expired payment reference");
    }

    const payment = await verifyPayment({
      signature,
      reference,
      destination: intent.payTo,
      amountLamports: intent.amountLamports,
    });

    intent.status = "paid";
    intent.buyerWallet = buyerWallet || payment.buyerWallet;
    intent.txHash = signature;
    intent.updatedAt = ts();

    if (intent.action === "purchase") {
      const session = await createSession({
        ip: intent.ip,
        minutes: intent.minutes,
        txHash: signature,
        paymentReference: reference,
        paymentSource: "x402",
        paymentExplorerUrl: payment.explorerUrl,
        listingId: intent.listingId,
        sessionType: "agent",
        buyerWallet: intent.buyerWallet,
        tier: intent.tier,
        source: "x402-api",
      });
      persist();
      return { intent, payment, session };
    }

    const current = state.sessions.find((session) => session.session_id === intent.sessionId);
    if (!current) {
      throw new Error("Session to extend was not found");
    }

    const session = await createSession({
      ip: current.ip,
      minutes: intent.minutes,
      txHash: signature,
      paymentReference: reference,
      paymentSource: "x402",
      paymentExplorerUrl: payment.explorerUrl,
      listingId: current.listing_id,
      sessionType: current.session_type,
      buyerWallet: intent.buyerWallet,
      tier: intent.tier,
      source: "x402-api",
    });
    persist();
    return { intent, payment, session };
  }

  function getDashboard() {
    const sessions = listSessions();
    const active = sessions.filter((session) => session.active);
    const completed = sessions.filter((session) => !session.active);
    const refunded = sessions.filter((session) => session.status === "refunded");
    const totalEarnedSol = sessions.reduce((sum, session) => {
      const refund = session.refund?.amountSol || 0;
      return sum + Number(session.amount_sol || 0) - refund;
    }, 0);

    return {
      summary: {
        totalListings: state.listings.length,
        activeSessions: active.length,
        completedSessions: completed.length,
        totalEarnedSol,
        refunds: refunded.length,
      },
      listings: sortNewestFirst(state.listings),
      sessions,
      recentArtifacts: sessions
        .flatMap((session) => session.filecoin.artifacts.map((artifact) => ({
          sessionId: session.session_id,
          listingId: session.listing_id,
          kind: artifact.kind,
          cid: artifact.cid,
          createdAt: artifact.createdAt,
          synapse: artifact.synapse,
        })))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8),
    };
  }

  function getHealth() {
    const sessions = listSessions();
    return {
      status: "ok",
      active_sessions: sessions.filter((session) => session.active).length,
      total_sessions: sessions.length,
      total_listings: state.listings.length,
      x402_ready: Boolean(normalizeWallet(hostWallet)),
      filecoin_synapse_ready: Boolean(process.env.FILECOIN_PRIVATE_KEY),
      uptime_seconds: Math.floor(process.uptime()),
    };
  }

  createDefaultListing();
  ensureDemoListings();

  return {
    buildIntent,
    buildX402Challenge,
    createDefaultListing,
    createSession,
    disconnectSessionByIp,
    expireSessions,
    fulfillIntent,
    getActiveSessionForIp,
    getDashboard,
    getHealth,
    listListings: () => sortNewestFirst(state.listings),
    listSessions,
    normalizeIp,
    pickListing,
    pruneIntents,
    recordForwardedBytes,
    removeListing,
    upsertListing,
  };
}

module.exports = {
  createHotspotService,
  normalizeIp,
  normalizeSSID,
  redactIdentifier,
};
