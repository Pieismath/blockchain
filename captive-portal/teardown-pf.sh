#!/usr/bin/env bash
# HotspotDEX — remove pf rules and restore original config
# Usage: sudo ./teardown-pf.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Run as root: sudo ./teardown-pf.sh"
  exit 1
fi

PF_CONF="/etc/pf.conf"
BACKUP="${PF_CONF}.hotspotdex.bak"

# Flush our anchors
pfctl -a hotspotdex-nat -F all 2>/dev/null && echo "Flushed hotspotdex-nat anchor" || true
pfctl -a hotspotdex     -F all 2>/dev/null && echo "Flushed hotspotdex anchor"     || true

# Restore original pf.conf
if [ -f "$BACKUP" ]; then
  cp "$BACKUP" "$PF_CONF"
  pfctl -f "$PF_CONF"
  echo "Restored $PF_CONF from backup"
else
  echo "No backup found — manually remove the HotspotDEX block from $PF_CONF"
fi

rm -f /etc/pf.anchors/hotspotdex /etc/pf.anchors/hotspotdex-nat
echo "Removed anchor files"
echo "Done. pf restored to original state."
