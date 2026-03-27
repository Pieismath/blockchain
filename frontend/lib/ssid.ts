const SSID_PREFIX = "\u26a1HDX-";

function toSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
}

export function normalizeHotspotSsid(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const withoutPrefix = trimmed
    .replace(/^\u26a1\s*/u, "")
    .replace(/^HDX[-\s]*/i, "")
    .replace(/^hotspotdex[-\s]*/i, "");

  const slug = toSlug(withoutPrefix);
  return slug ? `${SSID_PREFIX}${slug}` : "";
}

export function buildHotspotSsid(name: string): string {
  return normalizeHotspotSsid(name);
}

export { SSID_PREFIX };
