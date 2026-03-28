"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Header() {
  const pathname = usePathname();

  const navLink = (href: string, label: string) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          active
            ? "bg-indigo-600 text-white"
            : "text-slate-400 hover:text-white hover:bg-white/5"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#07070f]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <svg
            className="w-7 h-7 text-emerald-400 group-hover:text-emerald-300 transition-colors"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <circle cx="12" cy="20" r="1" fill="currentColor" />
          </svg>
          <span className="text-lg font-bold tracking-tight text-white">Netra</span>
        </Link>

        <nav className="flex items-center gap-1">
          {navLink("/marketplace", "Marketplace")}
          {navLink("/host", "List Hotspot")}
          {navLink("/dashboard", "Dashboard")}
        </nav>

        <div className="hidden md:flex items-center gap-2 text-xs">
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
            Solana x402
          </span>
          <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
            Filecoin proofs
          </span>
        </div>
      </div>
    </header>
  );
}
