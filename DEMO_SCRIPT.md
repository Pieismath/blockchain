# 3-Minute Demo Script

## 0:00 - 0:20 Pitch

"Netra is a programmable paid hotspot. Humans pay through a real captive portal, agents pay through an x402 API on Solana, and every session produces a CID-backed proof artifact for portable reputation."

## 0:20 - 1:10 Human Flow

1. Open the marketplace:
   - [frontend/app/marketplace/page.tsx](/Users/jasonfang/Desktop/hotspot-dex/frontend/app/marketplace/page.tsx)
2. Click a hotspot card and open the access modal.
3. Explain:
   - buyer joins `⚡Netra-...`
   - no free roaming before payment
   - captive portal opens
4. If running the live hotspot demo on a phone:
   - join the hotspot
   - show the captive portal page
   - complete Phantom payment
5. Point out:
   - internet unlocks only after payment verification
   - Solana tx hash is visible
   - Filecoin receipt CID is visible on the phone UI

## 1:10 - 2:00 Agent / x402 Flow

1. Open:
   - `http://localhost:3001/x402/spec`
2. Run:

```bash
cd proxy-server
SOLANA_SECRET_KEY='[...]' node scripts/x402-demo.js
```

3. Narrate the flow:
   - first request gets `402 Payment Required`
   - script pays on Solana devnet
   - script retries with `Payment-Signature`
   - server unlocks access programmatically

## 2:00 - 2:40 Dashboard / Filecoin Proofs

1. Open the dashboard:
   - [frontend/app/dashboard/page.tsx](/Users/jasonfang/Desktop/hotspot-dex/frontend/app/dashboard/page.tsx)
2. Show:
   - active sessions
   - tx hashes
   - recent artifact CIDs
   - reputation score and refunds
3. Explain that these artifacts are what make hotspot history portable and tamper-resistant.

## 2:40 - 3:00 Close

"This is one product, not three demos: a real hotspot gate, Solana-native agentic payments over HTTP 402, and a durable Filecoin-backed proof layer for operational trust."

## Best Endpoints / Screens

- `http://localhost:3000/marketplace`
- `http://localhost:3000/dashboard`
- `http://localhost:3001/health`
- `http://localhost:3001/x402/spec`
- `proxy-server/scripts/x402-demo.js`
