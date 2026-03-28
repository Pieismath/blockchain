#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# HotspotDEX — pf firewall setup  (run once, needs sudo)
#
# What this does:
#   1. Detects the Mac's Internet Sharing bridge interface (bridge100)
#   2. Writes pf anchor rules that:
#        • Redirect DNS  (:53  → :5300) so all domain lookups hit our DNS server
#        • Redirect HTTP (:80  → :8888) so all HTTP hits our payment portal
#        • Block all other outbound traffic from hotspot clients by default
#        • Allow paid clients (table <allowed_clients>) full internet access
#   3. Loads the rules into pf
#
# Usage:
#   sudo ./setup-pf.sh
#
# After running this, start the portal server with:
#   node server.js      (no sudo needed)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root (sudo ./setup-pf.sh)"
  exit 1
fi

SOLANA_RPC_URL="${SOLANA_RPC:-https://api.devnet.solana.com}"
RPC_HOST="$(printf '%s\n' "$SOLANA_RPC_URL" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\1#')"
ALLOW_HOSTS="${RPC_HOST:-api.devnet.solana.com}"
ALLOW_IPS=""

echo "Resolving wallet/RPC allowlist..."
for host in $(printf '%s\n' "$ALLOW_HOSTS" | tr ',' ' '); do
  [ -n "$host" ] || continue
  echo "  allow $host"
  resolved=$(dscacheutil -q host -a name "$host" 2>/dev/null | awk '/ip_address:/{print $2}' | sort -u || true)
  if [ -z "$resolved" ]; then
    resolved=$(dig +short "$host" A 2>/dev/null | sort -u || true)
  fi
  if [ -n "$resolved" ]; then
    while IFS= read -r ip; do
      [ -n "$ip" ] || continue
      ALLOW_IPS="${ALLOW_IPS}${ALLOW_IPS:+, }$ip"
    done <<EOF
$resolved
EOF
  fi
done

# ── Detect interface and IP ───────────────────────────────────────────────────

BRIDGE=""
PORTAL_IP=""
FALLBACK_BRIDGE=""
FALLBACK_IP=""
FALLBACK_SCORE=-1

echo "Scanning network interfaces..."

# Prefer the active Internet Sharing bridge. Some Macs keep older inactive
# bridge interfaces around, and picking the first one breaks the captive rules.
for iface in $(printf '%s\n' bridge100 bridge101 bridge0 $(ifconfig -l 2>/dev/null | tr ' ' '\n' | grep '^bridge' | sort) | awk '!seen[$0]++'); do
  [ -n "$iface" ] || continue

  info=$(ifconfig "$iface" 2>/dev/null || true)
  [ -n "$info" ] || continue

  ip=$(printf '%s\n' "$info" | awk '/inet /{print $2; exit}')
  status=$(printf '%s\n' "$info" | awk '/status:/{print $2; exit}')
  has_ap1=$(printf '%s\n' "$info" | grep -c 'member: ap1' || true)
  score=0
  [ "$iface" = "bridge100" ] && score=$((score + 3))
  [ "$has_ap1" -gt 0 ] && score=$((score + 5))

  echo "  $iface → ${ip:-no IP} (${status:-unknown})"

  if [ -n "$ip" ] && [ "$score" -gt "$FALLBACK_SCORE" ]; then
    FALLBACK_BRIDGE="$iface"
    FALLBACK_IP="$ip"
    FALLBACK_SCORE="$score"
  fi

  if [ -n "$ip" ] && [ "$status" = "active" ]; then
    BRIDGE="$iface"
    PORTAL_IP="$ip"
    break
  fi
done

if [ -z "$BRIDGE" ] && [ -n "$FALLBACK_BRIDGE" ]; then
  BRIDGE="$FALLBACK_BRIDGE"
  PORTAL_IP="$FALLBACK_IP"
fi

if [ -z "$BRIDGE" ]; then
  echo ""
  echo "ERROR: No Internet Sharing bridge interface found."
  echo ""
  echo "All interfaces on this machine:"
  ifconfig -l | tr ' ' '\n'
  echo ""
  echo "Troubleshooting:"
  echo "  1. Make sure Internet Sharing is ON in System Settings → General → Sharing"
  echo "  2. Make sure Wi-Fi is checked in 'To devices using'"
  echo "  3. Try toggling Internet Sharing OFF then ON again"
  echo "  4. If you see a bridge interface above with no IP, run:"
  echo "       sudo ifconfig <bridgeX> 192.168.3.1 netmask 255.255.255.0 up"
  echo "     then re-run this script."
  echo ""
  exit 1
fi

echo "Bridge interface : $BRIDGE"
echo "Portal IP        : $PORTAL_IP"
HOTSPOT_SUBNET="${PORTAL_IP%.*}.0/24"
echo "Hotspot subnet   : $HOTSPOT_SUBNET"

# ── Write NAT anchor (redirect rules) ─────────────────────────────────────────

NAT_ANCHOR="/etc/pf.anchors/hotspotdex-nat"

cat > "$NAT_ANCHOR" << EOF
# HotspotDEX NAT anchor — redirect rules
# Redirect DNS queries from hotspot clients to our DNS server (no-root port)
rdr pass on $BRIDGE proto udp from any to any port 53 -> $PORTAL_IP port 5300

# Redirect ALL HTTP (port 80) to our portal server.
# This must include traffic destined for PORTAL_IP itself because our DNS
# resolves every domain to PORTAL_IP — so the iPhone's HTTP request to
# captive.apple.com already has destination PORTAL_IP:80.
rdr pass on $BRIDGE proto tcp from any to any port 80 -> $PORTAL_IP port 8888

# Redirect ALL HTTPS (port 443) to our HTTPS portal server.
# iOS 14+ and macOS probe https://captive.apple.com — without this redirect
# the TLS handshake times out and the device may suppress the captive portal popup.
rdr pass on $BRIDGE proto tcp from any to any port 443 -> $PORTAL_IP port 8443
EOF

echo "Written: $NAT_ANCHOR"

# ── Write filter anchor ────────────────────────────────────────────────────────

FILTER_ANCHOR="/etc/pf.anchors/hotspotdex"

WALLET_TABLE=""
WALLET_RULES=""
if [ -n "$ALLOW_IPS" ]; then
  WALLET_TABLE="table <wallet_allow_hosts> const { $ALLOW_IPS }"
  WALLET_RULES=$(cat <<EOF
# Allow only Solana payment RPC connectivity for unpaid users.
pass quick inet proto tcp from <hotspot_net> to <wallet_allow_hosts> port 443 keep state
pass quick inet proto udp from <hotspot_net> to <wallet_allow_hosts> port 443 keep state
EOF
)
fi

cat > "$FILTER_ANCHOR" << EOF
# HotspotDEX filter anchor
#
# Table of devices that have paid — populated dynamically by the portal server
# via: pfctl -t allowed_clients -T add <ip>
table <allowed_clients> persist
table <portal_host>     const { $PORTAL_IP }
table <hotspot_net>     const { $HOTSPOT_SUBNET }
$WALLET_TABLE

# Allow DHCP so devices can get an IP address
pass in quick on $BRIDGE proto udp from <hotspot_net> port 68 to any port 67 keep state

# Unpaid devices must stay on IPv4 so they cannot bypass the captive redirects.
block drop quick inet6 from <hotspot_net> to any
block drop quick inet6 from any to <hotspot_net>

# Allow traffic to the portal server itself (payment page + control API).
# These rules are the only unpaid paths out of the hotspot network.
pass quick inet proto tcp from <hotspot_net> to <portal_host> port { 8443, 8888, 3001, 3000 } keep state
pass quick inet proto udp from <hotspot_net> to <portal_host> port 5300 keep state
$WALLET_RULES

# Allow paid clients full outbound internet
pass quick inet from <allowed_clients> to any keep state
pass quick inet from any to <allowed_clients> keep state

# Block everything else from unpaid hotspot clients everywhere, not just on
# bridge0. This prevents a joined device from roaming freely before payment.
block return quick inet from <hotspot_net> to any
block drop   quick inet from any to <hotspot_net>
EOF

echo "Written: $FILTER_ANCHOR"

# ── Patch /etc/pf.conf ────────────────────────────────────────────────────────

PF_CONF="/etc/pf.conf"
MARKER="# HotspotDEX anchors"

if grep -q "hotspotdex" "$PF_CONF" 2>/dev/null; then
  echo "pf.conf already contains HotspotDEX anchors — rewriting to ensure correct placement"
fi

# Always write a clean, known-good pf.conf with HotspotDEX anchors in the
# correct position (rdr-anchor after nat-anchor "com.apple/*", filter anchor
# after the com.apple anchor block). This avoids the regex-patching approach
# which can break the file if the comment block layout differs.
cp "$PF_CONF" "${PF_CONF}.hotspotdex.bak" 2>/dev/null || true

cat > "$PF_CONF" << PFEOF
#
# Default PF configuration file.
#
# This file contains the main ruleset, which gets automatically loaded
# at startup.  PF will not be automatically enabled, however.  Instead,
# each component which utilizes PF is responsible for enabling and disabling
# PF via -E and -X as documented in pfctl(8).  That will ensure that PF
# is disabled only when the last enable reference is released.
#
# Care must be taken to ensure that the main ruleset does not get flushed,
# as the nested anchors rely on the anchor point defined here. In addition,
# to the anchors loaded by this file, some system services would dynamically
# insert anchors into the main ruleset. These anchors will be added only when
# the system service is used and would removed on termination of the service.
#
# See pf.conf(5) for syntax.
#

#
# com.apple anchor point
#
scrub-anchor "com.apple/*"
nat-anchor "com.apple/*"
rdr-anchor "com.apple/*"
rdr-anchor "hotspotdex-nat"
load anchor "hotspotdex-nat" from "$NAT_ANCHOR"
dummynet-anchor "com.apple/*"
anchor "com.apple/*"
load anchor "com.apple" from "/etc/pf.anchors/com.apple"
anchor "hotspotdex"
load anchor "hotspotdex" from "$FILTER_ANCHOR"
PFEOF

echo "Written: $PF_CONF"

# ── Enable pf and reload rules ────────────────────────────────────────────────

pfctl -e 2>/dev/null && echo "pf enabled" || echo "pf was already enabled"
if pfctl -f "$PF_CONF" 2>&1; then
  echo "pf rules loaded"
else
  echo ""
  echo "WARN: pf.conf reload had errors — loading anchors directly instead..."
  pfctl -a hotspotdex-nat -f "$NAT_ANCHOR" && echo "  nat anchor loaded"
  pfctl -a hotspotdex    -f "$FILTER_ANCHOR" && echo "  filter anchor loaded"
fi

# ── Verify ────────────────────────────────────────────────────────────────────

echo ""
echo "Current HotspotDEX anchor rules:"
pfctl -a hotspotdex -sr 2>/dev/null || echo "(anchor not yet populated — starts when portal server runs)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  pf setup complete!"
echo "  Bridge : $BRIDGE  ($PORTAL_IP)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next: run the portal server (no sudo needed):"
echo "  cd captive-portal && node server.js"
echo ""
