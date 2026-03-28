# Hackathon Tracks

## Primary Tracks

### 1. Solana — Best Use of Agentic Payments on Solana with x402

Why the fit is strong:

- The product now has a real HTTP 402 payment challenge flow for agentic buyers.
- `/x402/sessions/purchase` returns `402 Payment Required` with Solana devnet payment terms.
- A client pays on Solana devnet, retries with `Payment-Signature`, and the server verifies the transaction before unlocking access.
- Humans still use the captive portal, so the same product supports both consumer and programmatic access modes.

What judges should look at:

- [proxy-server/server.js](/Users/jasonfang/Desktop/hotspot-dex/proxy-server/server.js)
- [proxy-server/scripts/x402-demo.js](/Users/jasonfang/Desktop/hotspot-dex/proxy-server/scripts/x402-demo.js)
- [frontend/components/ConnectModal.tsx](/Users/jasonfang/Desktop/hotspot-dex/frontend/components/ConnectModal.tsx)
- The host dashboard showing tx hashes for active and completed sessions

### 2. Filecoin — Decentralized Infrastructure for Self-Sustaining AI

Why the fit is strong:

- Every important session creates a CID-backed artifact instead of only in-memory state.
- The backend persists session receipts, session closeouts, host profile snapshots, and reputation rollups.
- Hosts can inspect recent CIDs directly in the dashboard.
- The artifact pipeline is wired to Filecoin Synapse so the same receipts can be uploaded to Filecoin Onchain Cloud when credentials are configured.

What judges should look at:

- [proxy-server/lib/artifacts.js](/Users/jasonfang/Desktop/hotspot-dex/proxy-server/lib/artifacts.js)
- [proxy-server/lib/hotspot-service.js](/Users/jasonfang/Desktop/hotspot-dex/proxy-server/lib/hotspot-service.js)
- [frontend/app/dashboard/page.tsx](/Users/jasonfang/Desktop/hotspot-dex/frontend/app/dashboard/page.tsx)
- The visible CID fields in the captive portal and host dashboard

## Optional Third Track

### Arkhai — intentionally not targeted

Why it was skipped:

- Adding a separate conditional escrow layer would dilute the Solana x402 + Filecoin story.
- The strongest submission here is one coherent hotspot product, not a multi-chain bundle of half-integrated demos.
- Refund logic already exists as a practical hotspot guarantee, and the CID-backed session closeouts provide the evidence layer without needing extra chain sprawl.

## Demo Priority

1. Show that unpaid users do not get free internet.
2. Show Solana payment proof unlocking access.
3. Show the x402 agent purchase flow.
4. Show recent CID-backed artifacts and reputation on the dashboard.
