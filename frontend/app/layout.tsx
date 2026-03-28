import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "Netra — Solana-paid programmable hotspot",
  description:
    "Paid hotspot access for humans and agents with Solana receipts, x402 APIs, and Filecoin-backed session proofs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#07070f] text-[#e8e8f0]">
        <Header />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
