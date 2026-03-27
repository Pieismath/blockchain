"use client";

/**
 * /host — Host registration page
 *
 * Lets a hotspot owner list their network on the marketplace.
 * After submission the listing appears live in /marketplace.
 *
 * No ethernet needed: host runs this on their Mac, shares internet via
 * iPhone USB tethering → Internet Sharing → WiFi hotspot.
 */

import { useState } from "react";
import { createListing } from "@/lib/api";
import type { HotspotListing } from "@/lib/types";
import QrCode from "@/components/QrCode";

type Phase = "form" | "submitting" | "done";

export default function HostPage() {
  const [phase, setPhase] = useState<Phase>("form");
  const [listing, setListing] = useState<HotspotListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    ssid: "",
    location: "",
    pricePerMinute: "0.01",
    downloadMbps: "100",
    uploadMbps: "50",
    signalStrength: "4",
    host: "",
    hostIp: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("submitting");
    setError(null);
    try {
      const result = await createListing({
        name: form.name,
        ssid: form.ssid,
        location: form.location,
        pricePerMinute: parseFloat(form.pricePerMinute),
        downloadMbps: parseInt(form.downloadMbps),
        uploadMbps: parseInt(form.uploadMbps),
        signalStrength: parseInt(form.signalStrength),
        host: form.host || "anonymous",
        hostIp: form.hostIp || undefined,
      });
      setListing(result);
      setPhase("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create listing");
      setPhase("form");
    }
  }

  if (phase === "done" && listing) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Hotspot Listed!</h1>
          <p className="text-slate-400">Your network is now live on the marketplace.</p>
        </div>

        {/* Listing summary */}
        <div className="bg-[#0f0f1a] border border-white/8 rounded-2xl p-5 space-y-3 text-sm">
          <Row label="Name" value={listing.name} />
          <Row label="SSID" value={listing.ssid ?? "—"} mono />
          <Row label="Location" value={listing.location} />
          <Row label="Price" value={`${listing.pricePerMinute} ETH / min`} />
          <Row label="Speed" value={`${listing.downloadMbps}↓ / ${listing.uploadMbps}↑ Mbps`} />
          {listing.hostIp && <Row label="Proxy" value={`${listing.hostIp}:8080`} mono />}
        </div>

        {/* QR code linking to marketplace */}
        <div className="bg-[#0f0f1a] border border-white/8 rounded-2xl p-5 flex flex-col items-center gap-3">
          <p className="text-sm text-slate-400">Show this QR code — buyers scan to pay</p>
          <QrCode value={listing.portalUrl ?? `http://localhost:3000/marketplace`} size={180} />
          {listing.portalUrl && (
            <p className="text-xs text-slate-600 font-mono break-all text-center">{listing.portalUrl}</p>
          )}
        </div>

        {/* Setup instructions */}
        <div className="bg-[#0f0f1a] border border-white/8 rounded-2xl p-5 space-y-4">
          <h3 className="text-white font-semibold">Setup checklist</h3>
          <ol className="space-y-3 text-sm text-slate-400 list-none">
            <Step n={1} text="Plug iPhone into Mac via USB → enable Personal Hotspot on iPhone" />
            <Step n={2} text="Mac: System Settings → General → Sharing → Internet Sharing → Share from: iPhone USB → To: WiFi → turn on" />
            <Step n={3} text={`Your Mac now broadcasts WiFi SSID: "${form.ssid}"`} />
            <Step n={4} text="Run: cd captive-portal && node server.js" />
            <Step n={5} text="Buyers connect to your WiFi → portal pops up → they pay → internet opens" />
          </ol>
        </div>

        <div className="flex gap-3">
          <a
            href="/marketplace"
            className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold text-center transition-colors"
          >
            View Marketplace
          </a>
          <button
            onClick={() => { setPhase("form"); setListing(null); }}
            className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold transition-colors"
          >
            List Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">List Your Hotspot</h1>
        <p className="text-slate-400 mt-2">
          Share your internet, earn ETH per minute. No ethernet cable needed — use iPhone USB tethering.
        </p>
      </div>

      {/* No-ethernet tip */}
      <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 mb-6 text-sm text-indigo-300 space-y-1">
        <p className="font-semibold text-indigo-200">No ethernet? No problem.</p>
        <p>iPhone USB → Mac (Internet Sharing) → Mac broadcasts WiFi hotspot. Buyers connect to your Mac&apos;s hotspot.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Hotspot name" hint="e.g. CafeNova Uplink">
          <input
            required
            value={form.name}
            onChange={set("name")}
            placeholder="My Hotspot"
            className={inputCls}
          />
        </Field>

        <Field label="WiFi SSID" hint="The network name buyers will connect to">
          <input
            required
            value={form.ssid}
            onChange={set("ssid")}
            placeholder="HDX-MyHotspot"
            className={inputCls}
          />
        </Field>

        <Field label="Location" hint="Helps buyers find you">
          <input
            value={form.location}
            onChange={set("location")}
            placeholder="San Francisco, CA · Mission District"
            className={inputCls}
          />
        </Field>

        <Field label="Your Mac's local IP" hint="Run: ipconfig getifaddr en0  (leave blank to auto-detect)">
          <input
            value={form.hostIp}
            onChange={set("hostIp")}
            placeholder="192.168.2.1"
            className={inputCls}
          />
        </Field>

        <Field label="Price per minute (ETH)">
          <input
            required
            type="number"
            step="0.001"
            min="0.001"
            value={form.pricePerMinute}
            onChange={set("pricePerMinute")}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Download (Mbps)">
            <input
              type="number"
              min="1"
              value={form.downloadMbps}
              onChange={set("downloadMbps")}
              className={inputCls}
            />
          </Field>
          <Field label="Upload (Mbps)">
            <input
              type="number"
              min="1"
              value={form.uploadMbps}
              onChange={set("uploadMbps")}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Signal strength">
          <select value={form.signalStrength} onChange={set("signalStrength")} className={inputCls}>
            <option value="5">5 bars — Excellent</option>
            <option value="4">4 bars — Good</option>
            <option value="3">3 bars — Fair</option>
            <option value="2">2 bars — Weak</option>
          </select>
        </Field>

        <Field label="Display handle (optional)" hint="Wallet address or name shown to buyers">
          <input
            value={form.host}
            onChange={set("host")}
            placeholder="0xabc...1234"
            className={inputCls}
          />
        </Field>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={phase === "submitting"}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {phase === "submitting" ? "Listing…" : "List My Hotspot"}
        </button>
      </form>
    </div>
  );
}

// ── small helpers ──────────────────────────────────────────────────────────────

const inputCls =
  "w-full bg-[#0f0f1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500 transition-colors";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300">
        {label}
        {hint && <span className="text-slate-600 font-normal"> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className={`text-white ${mono ? "font-mono text-xs" : "font-medium"} text-right`}>{value}</span>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-400 text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">
        {n}
      </span>
      <span>{text}</span>
    </li>
  );
}
