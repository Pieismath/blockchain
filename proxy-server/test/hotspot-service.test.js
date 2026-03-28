"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createHotspotService } = require("../lib/hotspot-service");

test("creates CID-backed session artifacts and dashboard stats", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hotspot-service-"));
  const service = createHotspotService({
    dataDir: tmp,
    localIp: "192.168.2.1",
    hostWallet: "5oNDL3swdJJF1g9DzJiZ4ynHXgszjAEpUkxVYejchzrY",
    verifyPayment: async () => ({
      signature: "test-sig",
      buyerWallet: "buyer-wallet",
      explorerUrl: "https://explorer.solana.com/tx/test-sig?cluster=devnet",
    }),
    now: (() => {
      let current = 1_700_000_000_000;
      return () => current;
    })(),
  });

  const session = await service.createSession({
    ip: "192.168.2.88",
    minutes: 10,
    txHash: "test-sig",
    paymentReference: "ref-123",
    paymentSource: "captive-portal",
    paymentExplorerUrl: "https://explorer.solana.com/tx/test-sig?cluster=devnet",
    listingId: "local-hotspot",
    sessionType: "human",
    buyerWallet: "buyer-wallet",
    source: "captive-portal",
  });

  assert.equal(session.status, "active");
  assert.ok(session.filecoin.latestCid);
  assert.ok(fs.existsSync(path.join(tmp, "artifacts", `${session.filecoin.latestCid}.json`)));

  const dashboard = service.getDashboard();
  assert.equal(dashboard.summary.activeSessions, 1);
  assert.equal(dashboard.recentArtifacts.length > 0, true);
});

test("returns a 402-style challenge and fulfills agent purchases", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hotspot-service-"));
  const service = createHotspotService({
    dataDir: tmp,
    localIp: "192.168.2.1",
    hostWallet: "5oNDL3swdJJF1g9DzJiZ4ynHXgszjAEpUkxVYejchzrY",
    verifyPayment: async ({ signature, reference }) => ({
      signature,
      buyerWallet: "buyer-wallet",
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      reference,
    }),
  });

  const intent = service.buildIntent({
    ip: "10.0.0.22",
    minutes: 5,
    listingId: "local-hotspot",
    buyerWallet: "buyer-wallet",
    tier: "priority",
    action: "purchase",
  });
  const challenge = service.buildX402Challenge(intent, "/x402/sessions/purchase", "Agent hotspot access");

  assert.equal(challenge.error, "payment_required");
  assert.equal(challenge.accepts[0].network, "solana-devnet");

  const result = await service.fulfillIntent({
    reference: intent.reference,
    signature: "agent-sig",
    buyerWallet: "buyer-wallet",
  });

  assert.equal(result.session.session_type, "agent");
  assert.equal(result.session.tx_hash, "agent-sig");
});

test("disconnecting early refunds the unused prorated amount", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hotspot-service-"));
  let current = 1_700_000_000_000;
  const service = createHotspotService({
    dataDir: tmp,
    localIp: "192.168.2.1",
    hostWallet: "5oNDL3swdJJF1g9DzJiZ4ynHXgszjAEpUkxVYejchzrY",
    now: () => current,
    sendRefund: async ({ destination, amountLamports }) => {
      assert.equal(destination, "buyer-wallet");
      return {
        status: "sent",
        signature: "refund-sig",
        explorerUrl: "https://explorer.solana.com/tx/refund-sig?cluster=devnet",
        sourceWallet: "refund-wallet",
      };
    },
  });

  const session = await service.createSession({
    ip: "192.168.2.55",
    minutes: 10,
    txHash: "pay-sig",
    paymentReference: "ref-456",
    paymentSource: "captive-portal",
    paymentExplorerUrl: "https://explorer.solana.com/tx/pay-sig?cluster=devnet",
    listingId: "local-hotspot",
    sessionType: "human",
    buyerWallet: "buyer-wallet",
    source: "captive-portal",
  });

  current += 2.5 * 60 * 1000;
  const result = await service.disconnectSessionByIp(session.ip);

  assert.equal(result.minutes_used, 2.5);
  assert.equal(result.minutes_remaining, 7.5);
  assert.equal(result.refund_amount, 0.0075);
  assert.equal(result.refund_status, "sent");
  assert.equal(result.refund_tx_hash, "refund-sig");
  assert.equal(result.session.status, "refunded");
  assert.equal(result.session.refund.txHash, "refund-sig");
});
