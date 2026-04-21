/**
 * /marketplace — Buyer view
 *
 * Fetches live listings from the control API. Falls back to hardcoded
 * demo listings if the API is unreachable (so the UI always renders).
 */

import { LISTINGS as FALLBACK_LISTINGS } from "@/lib/listings";
import type { HotspotListing } from "@/lib/types";
import HotspotCard from "@/components/HotspotCard";
import { CONTROL_API } from "@/lib/control";

export const metadata = {
  title: "Marketplace — Netra",
};

async function fetchListings(): Promise<HotspotListing[]> {
  try {
    const res = await fetch(`${CONTROL_API}/listings`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`control API returned ${res.status}`);
    const live: HotspotListing[] = await res.json();
    if (!Array.isArray(live) || live.length === 0) return FALLBACK_LISTINGS;
    return live;
  } catch (error) {
    console.warn("[marketplace] falling back to demo listings:", error);
    return FALLBACK_LISTINGS;
  }
}

export default async function MarketplacePage() {
  const listings = await fetchListings();
  const available = listings.filter((l) => l.status === "available").length;
  const avgRate =
    listings.length === 0
      ? "—"
      : (
          listings.reduce((sum, listing) => sum + listing.pricePerMinute, 0) /
          listings.length
        ).toFixed(4) + " SOL/min";

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_35%),linear-gradient(180deg,#0b1220,#090d15)] px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">
              Solana x402 + Filecoin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Paid hotspot access for humans and agents.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              Join a real Wi-Fi hotspot, stay blocked until payment clears, then unlock timed internet access with a Solana receipt and a CID-backed session log.
            </p>
          </div>
          <a
            href="/host"
            className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            List My Hotspot
          </a>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Live listings", value: listings.length },
            { label: "Available now", value: available },
            { label: "Avg rate", value: avgRate },
            { label: "Primary gate", value: "No internet until paid" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4"
            >
              <p className="text-2xl font-semibold text-white">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-sky-500/20 bg-sky-500/10 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-sky-100/80">
          Judge Demo Flow
        </h3>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="flex gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-200">
              1
            </span>
            <div>
              <p className="font-medium text-white">Human checkout</p>
              <p className="mt-0.5 text-sky-50/75">
                Join a <span className="font-mono text-sky-100">⚡Netra-</span> hotspot and the captive portal blocks browsing until Phantom payment clears.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-200">
              2
            </span>
            <div>
              <p className="font-medium text-white">Agent checkout</p>
              <p className="mt-0.5 text-sky-50/75">
                Hit the x402 purchase endpoint and receive HTTP 402 with Solana payment terms before service is granted.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-200">
              3
            </span>
            <div>
              <p className="font-medium text-white">Portable proof</p>
              <p className="mt-0.5 text-sky-50/75">
                Each session generates a Filecoin-style CID artifact that hosts can audit in the dashboard.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Listings grid */}
      {listings.length === 0 ? (
        <div className="py-20 text-center text-slate-500">
          <p className="text-lg">No hotspots listed yet.</p>
          <a href="/host" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
            Be the first to list yours →
          </a>
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {listings.map((listing) => (
            <HotspotCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
