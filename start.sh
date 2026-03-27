#!/usr/bin/env bash
# HotspotDEX — start all three services in one terminal
# Usage: ./start.sh
# Stop:  Ctrl+C  (kills all background processes)

set -e

# ── Find node/npm ──────────────────────────────────────────────────────────────
NVM_NODE="$HOME/.nvm/versions/node/v24.13.1/bin"
if [ -d "$NVM_NODE" ]; then
  export PATH="$NVM_NODE:$PATH"
fi

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Install Node.js >= 18 first."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS="$ROOT/contracts"
PROXY="$ROOT/proxy-server"
FRONTEND="$ROOT/frontend"
PORTAL="$ROOT/captive-portal"

# Pass --captive flag to also start the captive portal (iPhone mode)
CAPTIVE_MODE=false
for arg in "$@"; do
  [ "$arg" = "--captive" ] && CAPTIVE_MODE=true
done

# ── Cleanup on Ctrl+C ─────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$HARDHAT_PID" "$PROXY_PID" "$FRONTEND_PID" "$PORTAL_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM

# ── Install deps if needed ────────────────────────────────────────────────────
DIRS="$CONTRACTS $PROXY $FRONTEND"
$CAPTIVE_MODE && DIRS="$DIRS $PORTAL"

for dir in $DIRS; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing deps in $dir..."
    (cd "$dir" && npm install --silent)
  fi
done

# ── 1. Start Hardhat node ─────────────────────────────────────────────────────
echo "[1/3] Starting Hardhat local node on :8545..."
(cd "$CONTRACTS" && npx hardhat node --hostname 127.0.0.1) \
  > /tmp/hardhat.log 2>&1 &
HARDHAT_PID=$!

# Wait for Hardhat to be ready
for i in $(seq 1 20); do
  if grep -q "Started HTTP" /tmp/hardhat.log 2>/dev/null; then break; fi
  sleep 0.5
done

# ── 2. Deploy contract ────────────────────────────────────────────────────────
echo "[2/3] Deploying HotspotEscrow contract..."
DEPLOY_OUT=$(cd "$CONTRACTS" && npx hardhat run scripts/deploy.js --network localhost 2>&1)
echo "$DEPLOY_OUT"
CONTRACT_ADDR=$(echo "$DEPLOY_OUT" | grep "Contract :" | awk '{print $3}')

if [ -n "$CONTRACT_ADDR" ]; then
  echo "NEXT_PUBLIC_ESCROW_ADDRESS=$CONTRACT_ADDR" > "$FRONTEND/.env.local"
  echo "NEXT_PUBLIC_CONTROL_API=http://localhost:3001" >> "$FRONTEND/.env.local"
  echo "Contract address written to frontend/.env.local"
fi

# ── 3. Start proxy server ─────────────────────────────────────────────────────
echo "[3/3] Starting proxy server on :8080 (control API :3001)..."
(cd "$PROXY" && node server.js) > /tmp/proxy.log 2>&1 &
PROXY_PID=$!

# ── 4. Start frontend ─────────────────────────────────────────────────────────
echo ""
echo "Starting Next.js frontend on :3000..."
(cd "$FRONTEND" && npm run dev) > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo "Waiting for frontend..."
for i in $(seq 1 30); do
  if grep -qE "Local:|localhost:3000" /tmp/frontend.log 2>/dev/null; then break; fi
  sleep 0.5
done

# ── 5. Start captive portal (iPhone mode) ─────────────────────────────────────
PORTAL_PID=""
if $CAPTIVE_MODE; then
  echo "Starting captive portal (DNS :5300, HTTP :8888)..."
  (cd "$PORTAL" && node server.js) > /tmp/portal.log 2>&1 &
  PORTAL_PID=$!
  sleep 1
fi

# ── Summary ───────────────────────────────────────────────────────────────────
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  HotspotDEX is running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Marketplace  →  http://localhost:3000/marketplace"
echo "  List hotspot →  http://localhost:3000/host"
echo "  On network   →  http://$LOCAL_IP:3000"
echo "  Control API  →  http://localhost:3001/health"
echo "  Proxy        →  $LOCAL_IP:8080"
echo "  Chain        →  http://localhost:8545"
if $CAPTIVE_MODE; then
  PORTAL_IP=$(ipconfig getifaddr bridge100 2>/dev/null || echo "192.168.3.1")
  echo "  ──────────────────────────────────────────"
  echo "  Captive DNS  →  :5300  (pf rdr from :53)"
  echo "  Captive HTTP →  :8888  (pf rdr from :80)"
  echo "  Portal URL   →  http://$PORTAL_IP:8888"
  echo "  iPhone page  →  pops up automatically on connect"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  NO ETHERNET? Use iPhone USB tethering:"
echo "  1. Plug iPhone → Mac USB"
echo "  2. iPhone: Settings → Personal Hotspot → on"
echo "  3. Mac: System Settings → Sharing → Internet Sharing"
echo "     Share from: iPhone USB  →  To: WiFi  → turn on"
echo "  4. Run: ./start.sh --captive"
echo ""
echo "  Press Ctrl+C to stop everything"
echo ""

# Stream all logs
LOG_FILES="/tmp/proxy.log /tmp/frontend.log /tmp/hardhat.log"
$CAPTIVE_MODE && LOG_FILES="$LOG_FILES /tmp/portal.log"
tail -f $LOG_FILES &
TAIL_PID=$!

wait "$PROXY_PID" "$FRONTEND_PID" "$HARDHAT_PID"
kill "$TAIL_PID" 2>/dev/null
