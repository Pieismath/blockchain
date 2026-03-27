# HotspotDEX

Peer-to-peer WiFi hotspot marketplace. Hosts list their hotspot with a price per minute. Buyers pay upfront into an escrow smart contract, get recognised by a local proxy server as a paying customer, and receive internet access. Unused time is refunded automatically.

```
hotspot-dex/
├── proxy-server/   Node.js HTTP proxy (port 8080) + control API (port 3001)
├── frontend/       Next.js 14 app router UI  (port 3000)
└── contracts/      Solidity escrow contract  (Hardhat, local node port 8545)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 (tested on v24) |
| npm | ≥ 9 |

No paid APIs or services required.

---

## Step 1 — Proxy Server

```bash
cd proxy-server
npm install
node server.js
```

Two servers start:

| Port | Purpose |
|------|---------|
| **8080** | HTTP proxy — configure your browser/system to use this |
| **3001** | Control REST API used by the frontend |

### Control API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Proxy status + uptime |
| GET | `/sessions` | List all sessions (active + expired) |
| POST | `/sessions` | Body: `{ ip, session_id, minutes_purchased, tx_hash }` — activate a session |
| DELETE | `/sessions/:ip` | Early exit — returns `{ minutes_used, minutes_remaining, refund_amount }` |

### How the proxy works

Every HTTP request that passes through port 8080 is checked against an in-memory session store keyed by client IP.

- **Active session** (`paid_until` is in the future) → request is forwarded normally.
- **No session / expired** → HTTP 402 Payment Required with JSON body pointing the buyer to the marketplace.

HTTPS `CONNECT` tunnels are handled the same way.

---

## Step 2 — Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

### Pages

| URL | View | Description |
|-----|------|-------------|
| `/marketplace` | Buyer | 4 hotspot listings, connect modal, countdown timer, disconnect button |
| `/dashboard` | Host | Live session list, earnings summary, past session log with mock Filecoin CIDs |

The frontend calls the proxy control API directly from the browser (`http://localhost:3001`).
No wallet connection is required to browse — a "Connect Wallet" button is shown but doesn't gate any UI.

### Environment variables (optional)

Create `frontend/.env.local` to override defaults:

```env
NEXT_PUBLIC_CONTROL_API=http://localhost:3001
NEXT_PUBLIC_ESCROW_ADDRESS=<deployed contract address>
```

---

## Step 3 — Smart Contract

The contract holds ETH in escrow for the duration of a WiFi session.

### Run a local Hardhat node

```bash
cd contracts
npm install

# Terminal A — keeps running
npm run node

# Terminal B — deploy once the node is up
npm run deploy
```

Copy the printed contract address into `frontend/.env.local`:

```env
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
```

### Run tests

```bash
cd contracts
npx hardhat test
```

All 8 tests should pass (createSlot, endSlot, earlyExit, getSlot).

### Contract: `HotspotEscrow.sol`

```
createSlot(host, pricePerMinute, numMinutes) payable
  → buyer sends ETH, slot created, funds held

endSlot(slotId)
  → called after full session, all ETH to host

earlyExit(slotId)
  → host paid for minutes used (ceil), buyer refunded the rest

getSlot(slotId)
  → view: returns all slot fields
```

Events emitted: `SlotCreated`, `SlotEnded`, `EarlyExit`.

---

## Running all three together

Open **four terminals**:

```bash
# Terminal 1 — Hardhat local chain
cd contracts && npm run node

# Terminal 2 — Deploy contract (after node is up)
cd contracts && npm run deploy

# Terminal 3 — Proxy server
cd proxy-server && node server.js

# Terminal 4 — Frontend
cd frontend && npm run dev
```

Then open `http://localhost:3000`.

### Demo flow

1. Configure your browser proxy to `localhost:8080`.
2. Go to `/marketplace`, pick a hotspot, choose a duration, click **Pay & Connect**.
3. A mock tx hash is generated and the session is activated via the control API.
4. Your browser traffic is now forwarded through the proxy. The countdown timer ticks down.
5. Click **Disconnect Early** to trigger a refund calculation; or let it run to zero for the host to receive full payment.
6. Check `/dashboard` to see the live session and earnings.

---

## Architecture diagram

```
Browser (port 3000)
   │  buys session via POST /sessions
   ▼
Proxy Control API (port 3001)
   │  activates session in memory store
   ▼
Proxy Server (port 8080)
   │  checks session store per IP
   │  ALLOWED → forwards traffic
   └─ BLOCKED → 402 Payment Required

Smart Contract (Hardhat :8545)
   │  createSlot()  — holds ETH
   │  endSlot()     — pays host
   └─ earlyExit()   — splits payment
```

---

## What's mocked / what's next

| Feature | Current state | Next step |
|---------|--------------|-----------|
| Payment | Simulated (random tx hash) | Wire MetaMask → `createSlot()` |
| Refunds | Calculated by proxy, displayed in UI | Call `earlyExit()` on-chain |
| Filecoin CIDs | Hardcoded fake CIDv1 strings | Store session logs via Filecoin/IPFS |
| IP detection | Uses `127.0.0.1` for demo | Use real client IP in production |
| Proxy auth | In-memory only | Persist sessions to Redis / DB |
