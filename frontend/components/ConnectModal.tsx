"use client";

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import type { HotspotListing, ProxySession } from "@/lib/types";
import { createSession, deleteSession, getMyIp } from "@/lib/api";

const QrCode = lazy(() => import("./QrCode"));

const DURATION_OPTIONS = [5, 10, 30] as const;
type Duration = (typeof DURATION_OPTIONS)[number];

interface Props {
  listing: HotspotListing;
  onClose: () => void;
}

type Phase = "select" | "paying" | "active" | "refunded";

function generateTxHash(): string {
  return (
    "0x" +
    Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("")
  );
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

/** Format seconds as mm:ss */
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function ConnectModal({ listing, onClose }: Props) {
  const [duration, setDuration] = useState<Duration>(10);
  const [phase, setPhase] = useState<Phase>("select");
  const [session, setSession] = useState<ProxySession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [refundInfo, setRefundInfo] = useState<{
    minutes_used: number;
    refund_amount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalCost = (listing.pricePerMinute * duration).toFixed(4);

  // ── Countdown timer while session is active ──────────────────────────────
  useEffect(() => {
    if (phase !== "active" || secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          setPhase("refunded"); // session naturally expired — full payment to host
          setRefundInfo({ minutes_used: duration, refund_amount: 0 });
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, secondsLeft, duration]);

  // ── Pay & Connect ────────────────────────────────────────────────────────
  const handlePay = useCallback(async () => {
    setPhase("paying");
    setError(null);

    try {
      // Simulate blockchain tx delay
      await new Promise((r) => setTimeout(r, 1200));

      const session_id = generateSessionId();
      const tx_hash = generateTxHash();

      // Detect the buyer's real IP (works for iPhone through proxy too)
      const { ip } = await getMyIp();

      // Activate session on the proxy control API
      const result = await createSession({
        ip,
        session_id,
        minutes_purchased: duration,
        tx_hash,
      });

      setSession(result.session);
      setSecondsLeft(result.seconds_granted);
      setPhase("active");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create session"
      );
      setPhase("select");
    }
  }, [duration]);

  // ── Early disconnect ─────────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    if (!session) return;
    try {
      const result = await deleteSession(session.ip);
      setRefundInfo({
        minutes_used: result.minutes_used,
        refund_amount: result.refund_amount,
      });
      setPhase("refunded");
      setSecondsLeft(0);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect"
      );
    }
  }, [session]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md bg-[#0f0f1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {listing.name}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">{listing.location}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* ── SELECT DURATION ─────────────────────────────────────── */}
          {(phase === "select" || phase === "paying") && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Session duration
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {DURATION_OPTIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`py-3 rounded-xl text-sm font-semibold border transition-all ${
                        duration === d
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "bg-white/5 border-white/10 text-slate-300 hover:border-indigo-500/50"
                      }`}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost breakdown */}
              <div className="bg-white/5 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-slate-400">
                  <span>Rate</span>
                  <span>{listing.pricePerMinute} ETH / min</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Duration</span>
                  <span>{duration} minutes</span>
                </div>
                <div className="h-px bg-white/10" />
                <div className="flex justify-between font-semibold text-white">
                  <span>Total</span>
                  <span>{totalCost} ETH</span>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={handlePay}
                disabled={phase === "paying"}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
              >
                {phase === "paying" ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Confirming transaction…
                  </span>
                ) : (
                  `Pay ${totalCost} ETH & Connect`
                )}
              </button>
            </>
          )}

          {/* ── ACTIVE SESSION ────────────────────────────────────────── */}
          {phase === "active" && session && (
            <div className="space-y-4 text-center">
              {/* Big countdown */}
              <div className="py-4">
                <div className="text-5xl font-mono font-bold text-white tracking-widest">
                  {fmtTime(secondsLeft)}
                </div>
                <p className="text-slate-400 mt-2 text-sm">time remaining</p>
              </div>

              {/* WiFi connection instructions */}
              {listing.ssid && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-left space-y-3">
                  <p className="text-emerald-400 font-semibold text-sm">Now connect your WiFi</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Network (SSID)</span>
                      <span className="text-white font-mono font-semibold">{listing.ssid}</span>
                    </div>
                    {listing.hostIp && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Proxy</span>
                        <span className="text-white font-mono">{listing.hostIp}:8080</span>
                      </div>
                    )}
                  </div>
                  {listing.ssid && (
                    <p className="text-xs text-slate-500">
                      iPhone: Settings → WiFi → {listing.ssid} → Configure Proxy → Manual → enter proxy above
                    </p>
                  )}
                </div>
              )}

              {/* QR code for captive portal */}
              {listing.portalUrl && (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs text-slate-500">Scan to open payment portal</p>
                  <Suspense fallback={<div className="w-40 h-40 bg-white/5 rounded-lg animate-pulse" />}>
                    <QrCode value={listing.portalUrl} size={140} />
                  </Suspense>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl p-3">
                  <div className="text-slate-400">Session ID</div>
                  <div className="text-white font-mono text-xs mt-1 truncate">
                    {session.session_id.slice(0, 8)}…
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-3">
                  <div className="text-slate-400">Paid</div>
                  <div className="text-emerald-400 font-semibold mt-1">
                    {totalCost} ETH
                  </div>
                </div>
              </div>

              <button
                onClick={handleDisconnect}
                className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 font-semibold transition-colors"
              >
                Disconnect Early
              </button>
            </div>
          )}

          {/* ── REFUNDED / ENDED ─────────────────────────────────────── */}
          {phase === "refunded" && (
            <div className="text-center space-y-5 py-4">
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {refundInfo?.refund_amount === 0 ? "Session complete" : "Refund processed"}
                </h3>
                <p className="text-slate-400 text-sm mt-1">
                  {refundInfo?.refund_amount === 0
                    ? "Host received full payment. Thanks for using HotspotDEX!"
                    : `${refundInfo?.refund_amount.toFixed(4)} ETH returned to your wallet`}
                </p>
              </div>
              {refundInfo && (
                <div className="bg-white/5 rounded-xl p-4 space-y-2 text-sm text-left">
                  <div className="flex justify-between text-slate-400">
                    <span>Minutes used</span>
                    <span>{refundInfo.minutes_used}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Refund amount</span>
                    <span className="text-emerald-400">
                      {refundInfo.refund_amount.toFixed(4)} ETH
                    </span>
                  </div>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
