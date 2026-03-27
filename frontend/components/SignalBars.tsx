"use client";

/** Visual WiFi signal strength indicator (1–5 bars). */
export default function SignalBars({ strength }: { strength: 1 | 2 | 3 | 4 | 5 }) {
  const bars = [1, 2, 3, 4, 5] as const;

  return (
    <div className="flex items-end gap-[2px] h-4">
      {bars.map((bar) => (
        <div
          key={bar}
          style={{ height: `${bar * 20}%` }}
          className={`w-1.5 rounded-sm transition-colors ${
            bar <= strength ? "bg-emerald-400" : "bg-white/10"
          }`}
        />
      ))}
    </div>
  );
}
