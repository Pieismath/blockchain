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
import { buildHotspotSsid, normalizeHotspotSsid, SSID_PREFIX } from "@/lib/ssid";

type Phase = "form" | "submitting" | "done";

function deriveHostIp(explicitHostIp: string) {
  const trimmed = explicitHostIp.trim();
  if (trimmed) return trimmed;
  if (typeof window === "undefined") return undefined;

  const host = window.location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1") {
    return undefined;
  }
  return host;
}

export default function HostPage() {
  const [phase, setPhase] = useState<Phase>("form");
  const [listing, setListing] = useState<HotspotListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    ssid: "",
    location: "",
    pricePerMinute: "0.001",
    downloadMbps: "100",
    uploadMbps: "50",
    signalStrength: "4",
    host: "",
    hostWallet: "",
    hostIp: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: val };
      if (k === "name") {
        next.ssid = buildHotspotSsid(val);
      }
      if (k === "ssid") {
        next.ssid = normalizeHotspotSsid(val);
      }
      return next;
    });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("submitting");
    setError(null);
    try {
      const resolvedHostIp = deriveHostIp(form.hostIp);
      const result = await createListing({
        id: "local-hotspot",
        name: form.name,
        ssid: form.ssid,
        location: form.location,
        pricePerMinute: parseFloat(form.pricePerMinute),
        downloadMbps: parseInt(form.downloadMbps),
        uploadMbps: parseInt(form.uploadMbps),
        signalStrength: parseInt(form.signalStrength),
        host: form.host || "Netra Test Account",
        hostWallet: form.hostWallet || undefined,
        hostIp: resolvedHostIp,
        real: true,
        demo: false,
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
      <div className="mx-auto max-w-lg space-y-6 px-4 py-16">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Primary Hotspot Updated</h1>
          <p className="text-slate-400">Your live Netra hotspot is now ready for both captive-portal buyers and x402 clients.</p>
        </div>

        {/* Listing summary */}
        <div className="space-y-3 rounded-2xl border border-white/8 bg-[#0f0f1a] p-5 text-sm">
          <Row label="Name" value={listing.name} />
          <Row label="SSID" value={listing.ssid ?? "—"} mono />
          <Row label="Location" value={listing.location} />
          <Row label="Price" value={`${listing.pricePerMinute} SOL / min`} />
          <Row label="Speed" value={`${listing.downloadMbps}↓ / ${listing.uploadMbps}↑ Mbps`} />
          {listing.hostWallet && <Row label="Host wallet" value={listing.hostWallet} mono />}
          {listing.hostIp && <Row label="Proxy" value={`${listing.hostIp}:8080`} mono />}
          {listing.filecoin?.latestReputationCid && (
            <Row label="Reputation CID" value={listing.filecoin.latestReputationCid} mono />
          )}
        </div>

        {/* QR code linking to marketplace */}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/8 bg-[#0f0f1a] p-5">
          <p className="text-sm text-slate-400">Show this QR code to open the captive portal for your live hotspot</p>
          <QrCode value={listing.portalUrl ?? `http://localhost:3000/marketplace`} size={180} />
          {listing.portalUrl && (
            <p className="text-xs text-slate-600 font-mono break-all text-center">{listing.portalUrl}</p>
          )}
        </div>

        {/* Setup instructions */}
        <div className="space-y-4 rounded-2xl border border-white/8 bg-[#0f0f1a] p-5">
          <h3 className="text-white font-semibold">Setup checklist</h3>
          <ol className="space-y-3 text-sm text-slate-400 list-none">
            <Step n={1} text="Enable Internet Sharing on your Mac (share your connection over WiFi)" />
            <Step n={2} text={`Set your WiFi network name to: "${listing?.ssid ?? form.ssid}"`} />
            <Step n={3} text="Run: ./start.sh (starts everything automatically)" />
            <Step n={4} text="Human buyers connect, pay in Phantom, and only then get internet access." />
            <Step n={5} text="Agent buyers can call the x402 endpoint to purchase access programmatically on Solana devnet." />
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
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/70">Host Setup</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Launch a programmable hotspot</h1>
        <p className="mt-2 text-slate-400">
          Publish the live hotspot that buyers will actually connect to. Solana handles payment proof, and every session rolls into a CID-backed host reputation record.
        </p>
      </div>

      {/* How it works */}
      <div className="mb-6 space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
        <p className="font-semibold text-emerald-50">What judges will see</p>
        <p>Your hotspot updates the primary live listing, appears as <strong className="font-mono text-white">{SSID_PREFIX}YourName</strong>, blocks free roaming until payment clears, shows a Solana transaction proof, and leaves a portable Filecoin-style receipt trail in the dashboard.</p>
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

        <Field label="WiFi SSID" hint="Shows in buyers' WiFi settings — auto-generated from name">
          <input
            required
            value={form.ssid}
            onChange={set("ssid")}
            placeholder={`${SSID_PREFIX}CafeNova`}
            className={inputCls}
          />
          <p className="text-xs text-slate-600 mt-1">
            Tip: the {SSID_PREFIX} prefix is always added for you, even if you type a plain hotspot name.
          </p>
        </Field>

        <Field label="Location" hint="Helps buyers find you">
          <input
            value={form.location}
            onChange={set("location")}
            placeholder="San Francisco, CA · Mission District"
            className={inputCls}
          />
        </Field>

        <Field label="Hotspot IP" hint="Leave blank to use the current Netra page host automatically">
          <input
            value={form.hostIp}
            onChange={set("hostIp")}
            placeholder="192.168.2.1"
            className={inputCls}
          />
        </Field>

        <Field label="Price per minute (SOL)">
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
            placeholder="@cafenova"
            className={inputCls}
          />
        </Field>

        <Field label="Solana payout wallet" hint="Used by the captive portal and x402 payment challenges">
          <input
            value={form.hostWallet}
            onChange={set("hostWallet")}
            placeholder="4Nd1m...devnet"
            className={inputCls}
          />
        </Field>

        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={phase === "submitting"}
          className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-slate-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
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
