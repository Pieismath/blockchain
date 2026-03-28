#!/usr/bin/env bash
# Netra — start the Solana-first hotspot demo stack
# Usage: ./start.sh

set -e

NVM_NODE="$HOME/.nvm/versions/node/v24.13.1/bin"
if [ -d "$NVM_NODE" ]; then
  export PATH="$NVM_NODE:$PATH"
fi

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Install Node.js >= 18 first."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROXY="$ROOT/proxy-server"
FRONTEND="$ROOT/frontend"
PORTAL="$ROOT/captive-portal"

CAPTIVE_MODE=true
for arg in "$@"; do
  [ "$arg" = "--no-captive" ] && CAPTIVE_MODE=false
done

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$PROXY_PID" "$FRONTEND_PID" "$PORTAL_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM

DIRS="$PROXY $FRONTEND"
$CAPTIVE_MODE && DIRS="$DIRS $PORTAL"

for dir in $DIRS; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing deps in $dir..."
    (cd "$dir" && npm install --silent)
  fi
done

export HOTSPOT_NAME="${HOTSPOT_NAME:-Netra Test Account}"
export HOTSPOT_SSID="${HOTSPOT_SSID:-⚡Netra-Guest}"
export HOTSPOT_LISTING_ID="${HOTSPOT_LISTING_ID:-local-hotspot}"
export RATE_PER_MIN="${RATE_PER_MIN:-0.001}"
export HOTSPOT_DOWN="${HOTSPOT_DOWN:-100}"
export HOTSPOT_UP="${HOTSPOT_UP:-50}"
export HOTSPOT_SIGNAL="${HOTSPOT_SIGNAL:-4}"
export HOTSPOT_LOCATION="${HOTSPOT_LOCATION:-Philadelphia, PA · Demo hotspot}"
export HOST_HANDLE="${HOST_HANDLE:-Netra Test Account}"

export SOLANA_WALLET="${SOLANA_WALLET:-}"
export SOLANA_RPC="${SOLANA_RPC:-https://api.devnet.solana.com}"
export SECURE_PORTAL_ORIGIN="${SECURE_PORTAL_ORIGIN:-https://captive.apple.com}"
# Demo burner wallet — server signs + broadcasts the Solana tx automatically.
# Fund this address with devnet SOL before the demo.
# Burner pubkey: 6Hvij4HAnHJuSR6tg52mBWzJiFGFEd5rD2cpYFUf86gu
export DEMO_BUYER_PRIVKEY="${DEMO_BUYER_PRIVKEY:-5QiujvJwA4htB1eUqYYmbeKu42fScJ6JSAnKimTzLPkbSNDFpdYK7RrWJPWnGeKnEFWuVpPCCmBUbaFHrA1cWUpm}"
# Default the refund signer to the funded demo burner so early-disconnect
# refunds actually broadcast on devnet (self-transfer is valid on Solana).
export SOLANA_REFUND_SECRET_KEY="${SOLANA_REFUND_SECRET_KEY:-$DEMO_BUYER_PRIVKEY}"
export EXTRA_PREPAY_ALLOW_HOSTS="${EXTRA_PREPAY_ALLOW_HOSTS:-}"

export FILECOIN_NETWORK="${FILECOIN_NETWORK:-calibration}"
export FILECOIN_RPC_URL="${FILECOIN_RPC_URL:-}"
export FILECOIN_PRIVATE_KEY="${FILECOIN_PRIVATE_KEY:-}"
export FILECOIN_WITH_CDN="${FILECOIN_WITH_CDN:-false}"
export FILECOIN_SOURCE="${FILECOIN_SOURCE:-netra}"

echo "[1/3] Starting proxy server on :8080 (control API :3001)..."
(cd "$PROXY" && \
  HOTSPOT_NAME="$HOTSPOT_NAME" \
  HOTSPOT_SSID="$HOTSPOT_SSID" \
  HOTSPOT_LISTING_ID="$HOTSPOT_LISTING_ID" \
  RATE_PER_MIN="$RATE_PER_MIN" \
  HOTSPOT_DOWN="$HOTSPOT_DOWN" \
  HOTSPOT_UP="$HOTSPOT_UP" \
  HOTSPOT_SIGNAL="$HOTSPOT_SIGNAL" \
  HOTSPOT_LOCATION="$HOTSPOT_LOCATION" \
  HOST_HANDLE="$HOST_HANDLE" \
  SOLANA_WALLET="$SOLANA_WALLET" \
  SOLANA_RPC="$SOLANA_RPC" \
  SOLANA_REFUND_SECRET_KEY="$SOLANA_REFUND_SECRET_KEY" \
  FILECOIN_NETWORK="$FILECOIN_NETWORK" \
  FILECOIN_RPC_URL="$FILECOIN_RPC_URL" \
  FILECOIN_PRIVATE_KEY="$FILECOIN_PRIVATE_KEY" \
  FILECOIN_WITH_CDN="$FILECOIN_WITH_CDN" \
  FILECOIN_SOURCE="$FILECOIN_SOURCE" \
  node server.js) > /tmp/proxy.log 2>&1 &
PROXY_PID=$!

echo "[2/3] Starting Next.js frontend on :3000..."
(cd "$FRONTEND" && npm run dev) > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!

echo "Waiting for frontend..."
for i in $(seq 1 30); do
  if grep -qE "Local:|localhost:3000" /tmp/frontend.log 2>/dev/null; then break; fi
  sleep 0.5
done

PORTAL_PID=""
if $CAPTIVE_MODE; then
  echo "[3/3] Loading pf firewall rules (sudo required)..."
  sudo pfctl -e 2>/dev/null || true
  sudo pfctl -f /etc/pf.conf 2>/dev/null || true
  sudo pfctl -a hotspotdex-nat -f /etc/pf.anchors/hotspotdex-nat 2>/dev/null \
    && echo "pf NAT redirect rules loaded." \
    || echo "WARN: could not load NAT redirect rules"
  sudo pfctl -a hotspotdex -f /etc/pf.anchors/hotspotdex 2>/dev/null \
    && echo "pf filter rules loaded." \
    || echo "WARN: could not load filter rules"

  echo "Starting captive portal (DNS :5300, HTTP :8888)..."
  (cd "$PORTAL" && \
    HOTSPOT_NAME="$HOTSPOT_NAME" \
    HOTSPOT_SSID="$HOTSPOT_SSID" \
    HOTSPOT_LISTING_ID="$HOTSPOT_LISTING_ID" \
    RATE_PER_MIN="$RATE_PER_MIN" \
    HOTSPOT_DOWN="$HOTSPOT_DOWN" \
    HOTSPOT_UP="$HOTSPOT_UP" \
    HOTSPOT_SIGNAL="$HOTSPOT_SIGNAL" \
    HOTSPOT_LOCATION="$HOTSPOT_LOCATION" \
    SOLANA_WALLET="$SOLANA_WALLET" \
    SOLANA_RPC="$SOLANA_RPC" \
    SECURE_PORTAL_ORIGIN="$SECURE_PORTAL_ORIGIN" \
    EXTRA_PREPAY_ALLOW_HOSTS="$EXTRA_PREPAY_ALLOW_HOSTS" \
    DEMO_BUYER_PRIVKEY="$DEMO_BUYER_PRIVKEY" \
    CONTROL_API="http://localhost:3001" \
    node server.js) > /tmp/portal.log 2>&1 &
  PORTAL_PID=$!
  sleep 1
fi

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Netra is running"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Marketplace   →  http://localhost:3000/marketplace"
echo "  Host setup    →  http://localhost:3000/host"
echo "  Dashboard     →  http://localhost:3000/dashboard"
echo "  Control API   →  http://localhost:3001/health"
echo "  x402 spec     →  http://localhost:3001/x402/spec"
echo "  Proxy gate    →  http://localhost:8080"
if $CAPTIVE_MODE; then
  PORTAL_IP=$(
    for iface in bridge100 bridge101 bridge0; do
      info=$(ifconfig "$iface" 2>/dev/null || true)
      ip=$(printf '%s\n' "$info" | awk '/inet /{print $2; exit}')
      status=$(printf '%s\n' "$info" | awk '/status:/{print $2; exit}')
      if [ -n "$ip" ] && [ "$status" = "active" ]; then
        printf '%s\n' "$ip"
        break
      fi
    done
  )
  PORTAL_IP="${PORTAL_IP:-192.168.3.1}"
  echo "  ──────────────────────────────────────────"
  echo "  SSID          →  $HOTSPOT_SSID"
  echo "  Portal URL    →  http://$PORTAL_IP:8888"
  if [ "$SECURE_PORTAL_ORIGIN" != "https://captive.apple.com" ]; then
    echo "  Secure checkout →  $SECURE_PORTAL_ORIGIN"
    if [ -n "$EXTRA_PREPAY_ALLOW_HOSTS" ]; then
      echo "  Prepay allowlist →  $EXTRA_PREPAY_ALLOW_HOSTS"
    fi
  fi
  echo "  Solana RPC    →  $SOLANA_RPC"
  if [ -n "$SOLANA_WALLET" ]; then
    echo "  Solana wallet →  ${SOLANA_WALLET:0:8}…"
  else
    echo "  Solana wallet →  (not set — run: SOLANA_WALLET=<address> ./start.sh)"
  fi
  if [ -n "$DEMO_BUYER_PRIVKEY" ]; then
    echo "  Demo auto-pay →  ENABLED (burner: 6Hvij4HAnHJuSR6tg52mBWzJiFGFEd5rD2cpYFUf86gu)"
  fi
  if [ -n "$SOLANA_REFUND_SECRET_KEY" ]; then
    echo "  Refund signer →  custom"
  else
    echo "  Refund signer →  Netra demo treasury (devnet auto-top-up)"
  fi
  if [ -n "$FILECOIN_PRIVATE_KEY" ]; then
    echo "  Filecoin      →  Synapse enabled on $FILECOIN_NETWORK"
  else
    echo "  Filecoin      →  local CID mode (set FILECOIN_PRIVATE_KEY for Synapse uploads)"
  fi
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  SETUP (one-time):"
echo "  1. Mac: System Settings → Sharing → Internet Sharing"
echo "  2. Configure WiFi name to: $HOTSPOT_SSID"
echo "  3. Run: sudo ./captive-portal/setup-pf.sh"
echo ""
echo "  Optional agent demo:"
echo "    cd proxy-server && SOLANA_SECRET_KEY='[...]' node scripts/x402-demo.js"
echo ""
echo "  Press Ctrl+C to stop everything"
echo ""

LOG_FILES="/tmp/proxy.log /tmp/frontend.log"
$CAPTIVE_MODE && LOG_FILES="$LOG_FILES /tmp/portal.log"
tail -f $LOG_FILES &
TAIL_PID=$!

wait "$PROXY_PID" "$FRONTEND_PID"
kill "$TAIL_PID" 2>/dev/null
