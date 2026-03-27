/**
 * /marketplace — Buyer view
 *
 * Fetches live listings from the control API. Falls back to hardcoded
 * demo listings if the API is unreachable (so the UI always renders).
 */

import { LISTINGS as FALLBACK_LISTINGS } from "@/lib/listings";
import type { HotspotListing } from "@/lib/types";
import HotspotCard from "@/components/HotspotCard";

export const metadata = {
  title: "Marketplace — HotspotDEX",
};

async function fetchListings(): Promise<HotspotListing[]> {
  try {
    const res = await fetch("http://localhost:3001/listings", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("API error");
    const live: HotspotListing[] = await res.json();
    if (live.length === 0) return FALLBACK_LISTINGS;
    return live;
  } catch {
    return FALLBACK_LISTINGS;
  }
}

export default async function MarketplacePage() {
  const listings = await fetchListings();
  const available = listings.filter((l) => l.status === "available").length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Page header */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">WiFi Marketplace</h1>
          <p className="text-slate-400 mt-2">
            {available} hotspot{available !== 1 ? "s" : ""} available near you ·
            pay per minute, refund on early exit
          </p>
        </div>
        <a
          href="/host"
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"
        >
          + List My Hotspot
        </a>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Live listings", value: listings.length },
          { label: "Available now", value: available },
          {
            label: "Avg rate",
            value:
              listings.length === 0
                ? "—"
                : (
                    listings.reduce((s, l) => s + l.pricePerMinute, 0) /
                    listings.length
                  ).toFixed(3) + " ETH/min",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#0f0f1a] border border-white/8 rounded-xl px-5 py-4"
          >
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Listings grid */}
      {listings.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <p className="text-lg">No hotspots listed yet.</p>
          <a href="/host" className="text-indigo-400 hover:text-indigo-300 mt-2 inline-block">
            Be the first to list yours →
          </a>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
          {listings.map((listing) => (
            <HotspotCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
