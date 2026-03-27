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

echo "Scanning network interfaces..."

# Try all bridge* interfaces (bridge0, bridge100, bridge101, etc.)
for iface in $(ifconfig -l 2>/dev/null | tr ' ' '\n' | grep '^bridge' | sort); do
  # Try ipconfig first, fall back to parsing ifconfig output directly
  ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [ -z "$ip" ]; then
    ip=$(ifconfig "$iface" 2>/dev/null | awk '/inet /{print $2}' | head -1)
  fi
  echo "  $iface → ${ip:-no IP}"
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
