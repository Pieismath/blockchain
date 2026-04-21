# HotspotDEX Session Handoff

This file captures the important context from the current Codex session so it can be uploaded into a new thread.

## Repo

- Path: `/Users/jasonfang/Desktop/hotspot-dex`
- Primary remote: `https://github.com/Pieismath/blockchain`

## Product

HotspotDEX is a paid WiFi hotspot marketplace / captive portal hackathon submission focused on:

1. Solana x402 agentic payments
2. Filecoin CID-backed session proofs / logs / reputation

Core flow:

- A host shares internet through a hotspot.
- A buyer joins the hotspot.
- No general internet access is allowed until payment is verified.
- Human users go through the captive portal.
- Agent/programmatic clients use x402 endpoints.
- Solana devnet is the payment rail.
- Filecoin-backed artifacts store session receipts / logs / proofs.
- Session expiration revokes access.

## Repo Structure

- `frontend/`
- `proxy-server/`
- `captive-portal/`
- `start.sh`

## Major Work Already Implemented

### Solana x402

- `proxy-server` is the control plane.
- x402 purchase/extend endpoints exist.
- `POST /x402/sessions/purchase` returns real `402 Payment Required`.
- Solana devnet verification is implemented.
- Tx hashes are surfaced in UI / API.

Important files:

- `/Users/jasonfang/Desktop/hotspot-dex/proxy-server/server.js`
- `/Users/jasonfang/Desktop/hotspot-dex/proxy-server/lib/hotspot-service.js`
- `/Users/jasonfang/Desktop/hotspot-dex/proxy-server/lib/solana.js`

### Filecoin

- Session artifacts and CID-backed logs exist.
- Dashboard / portal surfaces Filecoin CIDs.

Important files:

- `/Users/jasonfang/Desktop/hotspot-dex/proxy-server/lib/artifacts.js`

### Docs

- `README.md`
- `HACKATHON_TRACKS.md`
- `ARCHITECTURE.md`
- `DEMO_SCRIPT.md`
- `.env.example`

## Marketplace Data State

Real hotspot only:

- `Netra Test Account`

Demo/filler hotspots in Philadelphia, PA:

- `Fishtown Commons`
- `Old City Relay`
- `University City Mesh`
- `Riverfront AP`

## Current Environment Values

- `SOLANA_WALLET=CRPNHN3oxc93MUb1JnG9JZvH8kgvXLtj3TVyaAayB2X8`
- `SOLANA_RPC=https://api.devnet.solana.com`

## Hotspot / Bridge Notes

Important real-device testing lesson:

- Do **not** hardcode `bridge100`.
- Use whichever hotspot bridge is actually **active** after the iPhone joins.
- Sometimes `bridge100` is active with `192.168.2.1`.
- Sometimes `bridge100` does not exist and only `bridge0` exists.
- `setup-pf.sh` must be run only **after** the phone is already connected.

Useful bridge check command:

```bash
ifconfig -l | tr ' ' '\n' | grep '^bridge'
for i in bridge0 bridge100 bridge101; do
  ifconfig "$i" 2>/dev/null | grep -E 'status|inet ' && echo "--- $i ---"
done
```

## Recent Real-Device Problem

Observed from iPhone testing:

- User taps `Pay`.
- UI shows a spinner / `Waiting for Phantom`.
- Repeated unpaid `GET /payment-status?...` requests appear in logs.
- Phantom does not launch reliably from the iPhone captive popup.
- At one point iOS showed:
  - `Cannot Verify Server Identity`
  - for `phantom.app`

That TLS warning happened because the captive portal was still DNS-trapping `phantom.app`, so the phone hit the local portal cert instead of the real Phantom host.

## Why The Older Flow Failed

- Server prebuilt a Solana Pay request.
- Client launched payment with raw `solana:` handoff.
- Client polled `/payment-status`.
- On iPhone captive browser, Phantom is unreliable on the `http://192.168.x.x` captive popup path.
- Async fetching before launch could break the user gesture.
- DNS interception of `phantom.app` caused TLS warnings.
- Result: no real wallet handoff, repeated unpaid polling, or a bounce back to marketplace.

## Latest Captive Portal Work

Work has been focused in:

- `/Users/jasonfang/Desktop/hotspot-dex/captive-portal/server.js`
- `/Users/jasonfang/Desktop/hotspot-dex/captive-portal/public/index.html`
- `/Users/jasonfang/Desktop/hotspot-dex/captive-portal/setup-pf.sh`

### Recent Server-Side Changes

Implemented or partially implemented:

- Added `GET /checkout`
- Added `GET /vendor/solana-web3.js`
- Added `GET /payment-transaction`
- Added `POST /payment-finalize`
- Added checkout/Phantom helper logic:
  - `buildCheckoutUrl(...)`
  - `buildPhantomBrowseUrl(...)`
  - `fulfillPendingPayment(...)`
- `payment-request` now stores more metadata in pending payment state:
  - `payTo`
  - `amountLamports`
  - `memo`
- `payment-request` now returns:
  - `checkoutUrl`
  - `phantomBrowseUrl`
- `payment-status` now delegates to shared finalize/unlock logic instead of duplicating session activation

### Recent Client-Side Changes

In `captive-portal/public/index.html`:

- Added local Solana browser bundle include:
  - `/vendor/solana-web3.js`
- Added checkout flow state:
  - `uiState.checkoutMode`
  - `checkoutReference`
  - `checkoutPayUrl`
- Added checkout helpers / logic:
  - `buildCheckoutUrl(req)`
  - `runInjectedCheckoutFlow()`
- On iPhone without injected Phantom, `Pay` no longer depends on the old fallback button path
- Checkout page is supposed to own wallet launch / sign / finalize
- `payment-finalize` is used after signature submission
- Polling remains as fallback verification rather than the main path

### DNS / Firewall Allowlist Changes

Pre-payment allowlist was updated to permit only:

- local captive portal
- Solana RPC
- `phantom.app`

Specifically:

- `captive-portal/server.js` DNS allowlist now includes Solana RPC host and `phantom.app`
- `captive-portal/setup-pf.sh` allowlist now includes:
  - `api.devnet.solana.com`
  - `phantom.app`

This keeps the network captive while still allowing wallet/RPC infrastructure.

## Current Suspected Remaining Bug

Latest observed behavior:

- Tapping `Pay` loads something briefly
- then immediately returns to the marketplace screen

Most likely cause:

- The checkout page loads
- Phantom is not injected there yet
- The client flow falls through instead of staying on checkout / continuing wallet handoff

This was being actively fixed at the end of the session.

Recent patch attempted to keep checkout in control instead of bouncing back:

- if checkout page loads without injected Phantom
- it should keep waiting UI visible
- and retry direct Phantom handoff from checkout rather than silently dumping back to marketplace

## Validation Already Run

These checks passed during the session:

```bash
node --check /Users/jasonfang/Desktop/hotspot-dex/captive-portal/server.js
bash -n /Users/jasonfang/Desktop/hotspot-dex/captive-portal/setup-pf.sh
cd /Users/jasonfang/Desktop/hotspot-dex/proxy-server && npm test
```

Also earlier:

```bash
cd /Users/jasonfang/Desktop/hotspot-dex/frontend && npm run build
```

## Git / Push State

A major repo snapshot was pushed earlier to `origin/main`.

Latest pushed commit before the newest unpushed captive-portal payment changes:

- `dec166b` — `Upgrade HotspotDEX for Solana x402 and Filecoin demo`

There may be newer unpushed local changes in:

- `captive-portal/server.js`
- `captive-portal/public/index.html`
- `captive-portal/setup-pf.sh`

## Exact Restart / Test Commands

After the iPhone is connected:

```bash
cd ~/Desktop/hotspot-dex
export SOLANA_RPC=https://api.devnet.solana.com
sudo ./captive-portal/setup-pf.sh
```

Then start the stack:

```bash
cd ~/Desktop/hotspot-dex
export SOLANA_WALLET=CRPNHN3oxc93MUb1JnG9JZvH8kgvXLtj3TVyaAayB2X8
export SOLANA_RPC=https://api.devnet.solana.com
bash ./start.sh
```

Then on iPhone:

- join hotspot
- open manual portal URL if needed:
  - `http://<active-portal-ip>:8888`
- tap `Pay ... with Phantom`

## What A New Thread Should Do

1. Inspect the current repo state first.
2. Verify whether the new checkout / Phantom browse flow is fully wired or still partially broken.
3. Fix the remaining iPhone captive portal payment issue:
   - `Pay` should not require a separate `Open Phantom` button
   - wallet handoff should be reliable
   - checkout should not bounce back to marketplace
   - session unlock should happen only after verified Solana transaction
4. Preserve strict captive enforcement:
   - no general internet pre-payment
   - only local portal + Solana RPC + `phantom.app`
5. Keep the Solana x402 and Filecoin story intact:
   - Solana verifies payment
   - Filecoin CID appears after session success

## Short Handoff Prompt

You can paste this into a new thread:

> Continue work in `/Users/jasonfang/Desktop/hotspot-dex`. Do not restart from scratch. Inspect the current repo state. HotspotDEX is a Solana x402 + Filecoin captive-portal hotspot project. The current main bug is iPhone payment flow: tapping Pay either gets stuck on unpaid polling or briefly loads then bounces back to marketplace instead of completing the Phantom handoff. Recent work added `/checkout`, `/vendor/solana-web3.js`, `/payment-transaction`, `/payment-finalize`, Phantom browse deeplink logic, and pre-payment allowlisting for Solana RPC + `phantom.app`. The active hotspot bridge must be detected after the phone joins; do not assume `bridge100` always exists. Fix the remaining captive-portal iPhone wallet flow so `Pay` reliably hands off to Phantom, verifies the Solana payment, unlocks the session, and shows tx hash + Filecoin CID, while keeping strict no-internet-until-paid enforcement.
