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
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white"
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
        // 30px tall, 3px radius, 16px text — the one place the old system goes
        // larger than body copy. The measured fill is #6188de, on which white
        // is 3.4:1; this keeps that hue and saturation exactly and drops only
        // the lightness (62.5% -> 55%), which clears 4.6:1. The placeholder is
        // solid white for the same reason — any dimming falls under the floor.
        // Hardcoded because the band's palette has no token yet.
        className="h-[30px] w-full rounded-md bg-[#4170d7] pl-8 pr-2 text-[16px] text-white placeholder:text-white focus:outline-none focus:ring-2 focus:ring-white/70"
      />
    </div>
  );
}
