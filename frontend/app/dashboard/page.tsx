"use client";

/**
 * /dashboard — Host view
 *
 * Pulls live session data from the proxy control API every 5 seconds.
 * Shows:
 *   - Total earnings (hardcoded baseline + live sessions)
 *   - Active sessions list
 *   - Past session log cards (with mock Filecoin CIDs)
 */

import { useEffect, useState, useCallback } from "react";
import type { ProxySession } from "@/lib/types";
import { getSessions, getHealth } from "@/lib/api";

// ─── Mock past sessions shown even before any live activity ──────────────────
const MOCK_PAST_SESSIONS: MockSession[] = [
  {
    id: "ps-001",
    buyer_ip: "192.168.1.42",
    minutes: 30,
    amount_earned: 0.3,
    timestamp: "2026-03-25T14:22:00Z",
    cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  },
  {
    id: "ps-002",
    buyer_ip: "10.0.0.17",
    minutes: 10,
    amount_earned: 0.1,
    timestamp: "2026-03-25T11:05:00Z",
    cid: "bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmr7yooeoy3zdhhq",
  },
  {
    id: "ps-003",
    buyer_ip: "172.16.0.8",
    minutes: 5,
    amount_earned: 0.05,
    timestamp: "2026-03-24T08:44:00Z",
    cid: "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354",
  },
];

interface MockSession {
  id: string;
  buyer_ip: string;
  minutes: number;
  amount_earned: number;
  timestamp: string;
  cid: string; // mock Filecoin CIDv1 for session log
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSeconds(s: number) {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<ProxySession[]>([]);
  const [health, setHealth] = useState<{
    status: string;
    active_sessions: number;
    uptime_seconds: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [proxyOnline, setProxyOnline] = useState(false);

  const BASELINE_EARNED = 0.45; // hardcoded historical earnings

  // ── Fetch sessions from proxy control API ──────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([getSessions(), getHealth()]);
      setSessions(s);
      setHealth(h);
      setProxyOnline(true);
    } catch {
      setProxyOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // poll every 5 s
    return () => clearInterval(interval);
  }, [refresh]);

  const activeSessions = sessions.filter((s) => s.active);
  const liveEarned = activeSessions.reduce((acc, s) => {
    const minutesConsumed =
      s.minutes_purchased - s.seconds_remaining / 60;
    return acc + minutesConsumed * 0.01;
  }, 0);
  const totalEarned = BASELINE_EARNED + liveEarned;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Host Dashboard</h1>
          <p className="text-slate-400 mt-1">
            Manage your hotspot earnings and active sessions
          </p>
        </div>
        {/* Proxy status indicator */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
            proxyOnline
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              proxyOnline ? "bg-emerald-400 animate-pulse" : "bg-red-400"
            }`}
          />
          Proxy {proxyOnline ? "online" : "offline"}
          {health && ` · ${health.uptime_seconds}s uptime`}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Total earned",
            value: `${totalEarned.toFixed(4)} ETH`,
            color: "text-emerald-400",
          },
          {
            label: "Active sessions",
            value: activeSessions.length,
            color: "text-indigo-400",
          },
          {
            label: "Completed sessions",
            value: MOCK_PAST_SESSIONS.length + (sessions.length - activeSessions.length),
            color: "text-white",
          },
          {
            label: "Proxy port",
            value: ":8080",
            color: "text-slate-300",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#0f0f1a] border border-white/8 rounded-xl px-5 py-4"
          >
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── Active sessions ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          Active Sessions
          <span className="ml-2 text-sm text-indigo-400 font-normal">
            (auto-refreshes every 5s)
          </span>
        </h2>

        {loading ? (
          <div className="text-slate-500 text-sm">Loading…</div>
        ) : activeSessions.length === 0 ? (
          <div className="bg-[#0f0f1a] border border-white/8 rounded-xl p-6 text-center text-slate-500 text-sm">
            No active sessions right now.{" "}
            {!proxyOnline && "Start the proxy server first."}
          </div>
        ) : (
          <div className="space-y-3">
            {activeSessions.map((s) => (
              <div
                key={s.session_id}
                className="bg-[#0f0f1a] border border-emerald-500/20 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <div>
                    <div className="text-white font-mono text-sm">
                      {s.ip}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      Session {s.session_id.slice(0, 8)}… · tx:{" "}
                      {s.tx_hash ? s.tx_hash.slice(0, 10) + "…" : "mock"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <span className="text-slate-400">Remaining </span>
                    <span className="font-mono text-white">
                      {fmtSeconds(s.seconds_remaining)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Purchased </span>
                    <span className="text-white">{s.minutes_purchased} min</span>
                  </div>
                  <div className="text-emerald-400 font-semibold">
                    +{(s.minutes_purchased * 0.01).toFixed(3)} ETH
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Session log ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          Session Log
          <span className="ml-2 text-xs text-slate-500 font-normal">
            Filecoin CIDs are mock — real storage integration coming soon
          </span>
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MOCK_PAST_SESSIONS.map((ps) => (
            <div
              key={ps.id}
              className="bg-[#0f0f1a] border border-white/8 rounded-xl p-5 space-y-3"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-white font-mono text-sm">{ps.buyer_ip}</div>
                  <div className="text-slate-500 text-xs mt-0.5">
                    {fmtDate(ps.timestamp)}
                  </div>
                </div>
                <span className="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded-lg">
                  {ps.minutes} min
                </span>
              </div>

              <div className="text-emerald-400 font-bold text-lg">
                +{ps.amount_earned.toFixed(3)} ETH
              </div>

              {/* Mock Filecoin CID */}
              <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                <div className="text-xs text-slate-500 mb-1">Filecoin CID</div>
                <div className="text-xs font-mono text-indigo-300 break-all">
                  {ps.cid}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
