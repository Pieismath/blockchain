"use client";

import { useState } from "react";
import type { HotspotListing } from "@/lib/types";
import SignalBars from "./SignalBars";
import ConnectModal from "./ConnectModal";

export default function HotspotCard({ listing }: { listing: HotspotListing }) {
  const [showModal, setShowModal] = useState(false);
  const available = listing.status === "available";

  return (
    <>
      <div className="relative bg-[#0f0f1a] border border-white/8 rounded-2xl p-5 flex flex-col gap-4 hover:border-indigo-500/40 transition-colors group">
        {/* Status badge */}
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              available
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-amber-500/10 text-amber-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                available ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            {available ? "Available" : "Occupied"}
          </span>
          <SignalBars strength={listing.signalStrength} />
        </div>

        {/* Name & location */}
        <div>
          <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
            {listing.name}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">{listing.location}</p>
          {listing.ssid && (
            <p className="text-xs text-indigo-400/70 font-mono mt-1">{listing.ssid}</p>
          )}
        </div>

        {/* Speed stats */}
        <div className="flex gap-4 text-xs text-slate-400">
          <div>
            <span className="text-slate-300 font-medium">{listing.downloadMbps}</span> Mbps ↓
          </div>
          <div>
            <span className="text-slate-300 font-medium">{listing.uploadMbps}</span> Mbps ↑
          </div>
        </div>

        {/* Price + connect */}
        <div className="flex items-center justify-between pt-1 border-t border-white/5">
          <div>
            <span className="text-lg font-bold text-white">
              {listing.pricePerMinute}
            </span>
            <span className="text-slate-400 text-sm"> ETH / min</span>
          </div>
          <button
            disabled={!available}
            onClick={() => setShowModal(true)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              available
                ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                : "bg-white/5 text-slate-500 cursor-not-allowed"
            }`}
          >
            {available ? "Connect" : "In use"}
          </button>
        </div>

        {/* Host */}
        <p className="text-xs text-slate-600">Host: {listing.host}</p>
      </div>

      {showModal && (
        <ConnectModal listing={listing} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
