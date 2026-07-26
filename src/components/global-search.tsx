"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

// Top-bar search, msgplane-style: nothing happens while typing — press Enter
// (or click the icon) and land on /search, which lists every matching order,
// shipper and carrier.
export function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");

  const go = () => {
    const q = term.trim();
    if (q.length < 2) return;
    onNavigate?.();
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Search"
        onClick={go}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-200 hover:text-white"
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go();
        }}
        placeholder="Search name, phone, email, order… ↵"
        aria-label="Global search"
        className="w-full rounded-md bg-white/15 py-1.5 pl-8 pr-2 text-sm text-white placeholder:text-blue-200 focus:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white/40"
      />
    </div>
  );
}
