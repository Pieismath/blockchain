"use client";

import { useEffect, useMemo, useState } from "react";
import { getDashboard, getHealth } from "@/lib/api";
import type { DashboardData, ProxySession } from "@/lib/types";

function fmtDate(iso?: string | null) {
  if (!iso) return "Pending";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTime(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.max(0, seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function sessionLabel(session: ProxySession) {
  return session.session_type === "agent"
    ? "x402 API"
    : "Captive portal";
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<{
    status: string;
    active_sessions: number;
    uptime_seconds: number;
    x402_ready?: boolean;
    filecoin_synapse_ready?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      try {
        const [dashboardData, healthData] = await Promise.all([
          getDashboard(),
          getHealth(),
        ]);
        if (!mounted) return;
        setDashboard(dashboardData);
        setHealth(healthData);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      }
    }

    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const activeSessions = useMemo(
    () => dashboard?.sessions.filter((session) => session.active) ?? [],
    [dashboard]
  );
  const completedSessions = useMemo(
    () => dashboard?.sessions.filter((session) => !session.active) ?? [],
    [dashboard]
  );
  const topListing = dashboard?.listings[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.2),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_35%),linear-gradient(180deg,#0b1220,#090d15)] px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/70">
              Host Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
              Proof, reputation, and live hotspot operations.
            </h1>
            <p className="mt-4 text-base leading-7 text-slate-300">
              This view consolidates captive-portal sessions, x402 programmatic purchases, Solana payment proofs, and the latest CID-backed artifacts for judges.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.05] px-4 py-3 text-sm text-slate-200">
            <div>Proxy status: {health ? "online" : "loading"}</div>
            <div className="mt-1 text-slate-400">
              x402 {health?.x402_ready ? "ready" : "awaiting wallet"} · Filecoin{" "}
              {health?.filecoin_synapse_ready ? "Synapse configured" : "local CID mode"}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-4">
          {[
            {
              label: "Earned",
              value: `${dashboard?.summary.totalEarnedSol.toFixed(4) || "0.0000"} SOL`,
            },
            {
              label: "Active sessions",
              value: dashboard?.summary.activeSessions ?? 0,
            },
            {
              label: "Completed sessions",
              value: dashboard?.summary.completedSessions ?? 0,
            },
            {
              label: "Refunds",
              value: dashboard?.summary.refunds ?? 0,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4"
            >
              <div className="text-2xl font-semibold text-white">{card.value}</div>
              <div className="mt-1 text-sm text-slate-500">{card.label}</div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="space-y-6">
          <div className="rounded-[28px] border border-white/8 bg-[#0d1420] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Live Sessions</h2>
              <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
                Refreshes every 5s
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {activeSessions.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-400">
                  No active sessions yet. Run the captive portal or x402 agent demo to populate this table.
                </div>
              ) : (
                activeSessions.map((session) => (
                  <div
                    key={session.session_id}
                    className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {sessionLabel(session)} · {session.ip}
                        </div>
                        <div className="mt-1 text-xs text-emerald-100/75">
                          Tx {session.tx_hash?.slice(0, 12)}... · CID{" "}
                          {session.filecoin.latestCid?.slice(0, 16)}...
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-2xl text-white">
                          {fmtTime(session.seconds_remaining)}
                        </div>
                        <div className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">
                          Remaining
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/8 bg-[#0d1420] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Recent Closeouts</h2>
              <span className="text-sm text-slate-500">
                {completedSessions.length} archived session{completedSessions.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/8">
              <table className="min-w-full divide-y divide-white/8 text-sm">
                <thead className="bg-white/[0.03] text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Ended</th>
                    <th className="px-4 py-3 font-medium">Tx</th>
                    <th className="px-4 py-3 font-medium">CID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 bg-[#091019] text-slate-200">
                  {completedSessions.slice(0, 6).map((session) => (
                    <tr key={session.session_id}>
                      <td className="px-4 py-3">{sessionLabel(session)}</td>
                      <td className="px-4 py-3">{fmtDate(session.ended_at || session.paid_until)}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {session.tx_hash ? `${session.tx_hash.slice(0, 12)}...` : "Pending"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {session.filecoin.latestCid
                          ? `${session.filecoin.latestCid.slice(0, 18)}...`
                          : "Pending"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-[28px] border border-white/8 bg-[#0d1420] p-6">
            <h2 className="text-lg font-semibold text-white">Hotspot Reputation</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <Metric label="Listing" value={topListing?.name || "Local hotspot"} />
              <Metric
                label="Reliability score"
                value={`${topListing?.reputation?.reliabilityScore ?? 100}%`}
              />
              <Metric
                label="Successful sessions"
                value={String(topListing?.reputation?.successfulSessions ?? 0)}
              />
              <Metric label="Refunds" value={String(topListing?.reputation?.refunds ?? 0)} />
              <Metric
                label="Reputation CID"
                value={topListing?.filecoin?.latestReputationCid || "Pending"}
                mono
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-white/8 bg-[#0d1420] p-6">
            <h2 className="text-lg font-semibold text-white">Recent Artifacts</h2>
            <div className="mt-4 space-y-3">
              {(dashboard?.recentArtifacts || []).map((artifact) => (
                <div
                  key={`${artifact.sessionId}-${artifact.cid}`}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-white">{artifact.kind}</span>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {artifact.synapse?.uploaded ? "Synapse uploaded" : "CID ready"}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-xs text-sky-200">{artifact.cid}</div>
                  <div className="mt-2 text-xs text-slate-500">{fmtDate(artifact.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-500/20 bg-sky-500/10 p-6">
            <h2 className="text-lg font-semibold text-white">Judge Notes</h2>
            <div className="mt-3 space-y-2 text-sm text-sky-50/85">
              <p>Human traffic remains blocked at the proxy and pf layer until payment verification succeeds.</p>
              <p>Agent traffic uses HTTP 402 on the x402 endpoint before access or extension is granted.</p>
              <p>Session receipts and reputation objects are persisted as CID-backed artifacts for portability.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? "max-w-[60%] break-all font-mono text-xs text-white" : "text-white"}>
        {value}
      </span>
    </div>
  );
}
