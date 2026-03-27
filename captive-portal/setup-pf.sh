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

# ── Detect interface and IP ───────────────────────────────────────────────────

BRIDGE=""
PORTAL_IP=""

for iface in bridge100 bridge101; do
  ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [ -n "$ip" ]; then
    BRIDGE="$iface"
    PORTAL_IP="$ip"
    break
  fi
done

if [ -z "$BRIDGE" ]; then
  echo ""
  echo "ERROR: No Internet Sharing bridge interface found."
  echo ""
  echo "Please enable Internet Sharing first:"
  echo "  Apple Menu → System Settings → General → Sharing"
  echo "  → Internet Sharing → share your connection over Wi-Fi"
  echo ""
  exit 1
fi

echo "Bridge interface : $BRIDGE"
echo "Portal IP        : $PORTAL_IP"

# ── Write NAT anchor (redirect rules) ─────────────────────────────────────────

NAT_ANCHOR="/etc/pf.anchors/hotspotdex-nat"

cat > "$NAT_ANCHOR" << EOF
# HotspotDEX NAT anchor — redirect rules
# Redirect DNS queries from hotspot clients to our DNS server (no-root port)
rdr pass on $BRIDGE proto udp from any to any port 53 -> $PORTAL_IP port 5300

# Redirect all HTTP (port 80) from hotspot clients to our portal server
# Skip traffic that's already headed to the portal IP itself
rdr pass on $BRIDGE proto tcp from any to ! $PORTAL_IP port 80 -> $PORTAL_IP port 8888
EOF

echo "Written: $NAT_ANCHOR"

# ── Write filter anchor ────────────────────────────────────────────────────────

FILTER_ANCHOR="/etc/pf.anchors/hotspotdex"

cat > "$FILTER_ANCHOR" << EOF
# HotspotDEX filter anchor
#
# Table of devices that have paid — populated dynamically by the portal server
# via: pfctl -t allowed_clients -T add <ip>
table <allowed_clients> persist
table <portal_host>     const { $PORTAL_IP }

# Allow DHCP so devices can get an IP address
pass in quick on $BRIDGE proto udp from any port 68 to any port 67

# Allow traffic to the portal server itself (payment page + control API)
pass in quick on $BRIDGE proto tcp from any to <portal_host> port { 8888, 3001, 3000 }
pass in quick on $BRIDGE proto udp from any to <portal_host> port 5300

# Allow paid clients full outbound internet
pass in  quick on $BRIDGE from <allowed_clients> to any
pass out quick on $BRIDGE to   <allowed_clients>

# Block everything else from unpaid clients
block in quick on $BRIDGE all
EOF

echo "Written: $FILTER_ANCHOR"

# ── Patch /etc/pf.conf ────────────────────────────────────────────────────────

PF_CONF="/etc/pf.conf"
MARKER="# HotspotDEX anchors"

if grep -q "hotspotdex" "$PF_CONF" 2>/dev/null; then
  echo "pf.conf already contains HotspotDEX anchors — skipping patch"
else
  # Back up original
  cp "$PF_CONF" "${PF_CONF}.hotspotdex.bak"
  echo "Backed up $PF_CONF → ${PF_CONF}.hotspotdex.bak"

  # Append our anchors (they must come after any existing nat rules)
  cat >> "$PF_CONF" << EOF

$MARKER
nat-anchor "hotspotdex-nat"
anchor "hotspotdex"
load anchor "hotspotdex-nat" from "$NAT_ANCHOR"
load anchor "hotspotdex" from "$FILTER_ANCHOR"
EOF

  echo "Patched: $PF_CONF"
fi

# ── Enable pf and reload rules ────────────────────────────────────────────────

pfctl -e 2>/dev/null && echo "pf enabled" || echo "pf was already enabled"
pfctl -f "$PF_CONF" && echo "pf rules loaded"

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
