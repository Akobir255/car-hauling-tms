"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, Truck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/app/api/search/route";

const ICON = { customer: User, carrier: Building2, load: Truck } as const;

// Sidebar omnibox: find a shipper by name/email/phone, a carrier company, or
// an order by its number. Debounced; results come from /api/search, which is
// RLS-scoped to the signed-in rep.
export function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // All state updates are deferred into the debounce timer / promise
  // callbacks — never called straight from the effect body, which the repo's
  // react-hooks/set-state-in-effect rule (a build error) forbids.
  useEffect(() => {
    const q = term.trim();
    const controller = new AbortController();
    if (q.length < 2) {
      const clear = setTimeout(() => {
        setHits([]);
        setBusy(false);
      }, 0);
      return () => clearTimeout(clear);
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits ?? []);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  // Click-away closes the result list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setTerm("");
    onNavigate?.();
    router.push(hit.href);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && hits.length > 0) go(hits[0]);
          }}
          placeholder="Search name, phone, email, order…"
          aria-label="Global search"
          className="w-full rounded-md bg-zinc-900 py-2 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          {hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-zinc-500">
              {busy ? "Searching…" : "Nothing found."}
            </p>
          )}
          {hits.map((hit) => {
            const Icon = ICON[hit.kind];
            return (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                onClick={() => go(hit)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                  "hover:bg-zinc-800"
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-100">
                    {hit.title}
                  </span>
                  {hit.detail && (
                    <span className="block truncate text-xs text-zinc-500">{hit.detail}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">
                  {hit.kind}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
