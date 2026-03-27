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
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          {/* WiFi / signal icon */}
          <svg
            className="w-7 h-7 text-indigo-500 group-hover:text-indigo-400 transition-colors"
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
          <span className="text-lg font-bold tracking-tight">
            <span className="text-white">Hotspot</span>
            <span className="text-indigo-400">DEX</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {navLink("/marketplace", "Marketplace")}
          {navLink("/host", "List Hotspot")}
          {navLink("/dashboard", "Dashboard")}
        </nav>

        {/* Wallet button — placeholder, no gating */}
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-sm font-medium text-slate-300 hover:border-indigo-500 hover:text-white transition-colors">
          <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
          Connect Wallet
        </button>
      </div>
    </header>
  );
}
