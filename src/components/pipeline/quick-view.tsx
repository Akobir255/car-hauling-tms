"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SquareArrowOutUpRight, X } from "lucide-react";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";

export type QuickViewData = {
  loadNumber: string;
  loadId: string;
  status: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  origin: string;
  destination: string;
  vehicles: string;
  tariff: number | null;
  deposit: number | null;
  carrierPay: number | null;
  firstAvail: string | null;
  shipperInfo: string | null;
  notes: string | null;
  assignedTo: string | null;
};

// The list's "quick view": the old system pops the record's key facts over
// the list instead of navigating. Anchored to the clicked row so the eye
// doesn't lose its place.
export function QuickView({ data, canSeeMargin }: { data: QuickViewData; canSeeMargin: boolean }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 420;
    setPos({
      top: Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 340)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
    });
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{value ?? "—"}</span>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setPos(null) : place())}
        className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
        quick view
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div
            className="fixed z-50 w-[420px] rounded-md border-2 border-neutral-800 bg-card p-3 text-sm shadow-2xl dark:border-neutral-300"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="mb-2 flex items-center gap-2 border-b pb-2">
              <Link
                href={`/loads/${data.loadId}`}
                className="font-semibold tabular-nums text-primary hover:underline"
              >
                {data.loadNumber}
              </Link>
              <span className="lowercase text-muted-foreground">{data.status}</span>
              <button
                type="button"
                onClick={() => setPos(null)}
                aria-label="Close quick view"
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {row("Shipper", data.customerName)}
              {row("Phone", data.phone ? formatPhone(data.phone) : null)}
              {row("Email", data.email)}
              {row("Assigned to", data.assignedTo)}
              {row("Origin", data.origin)}
              {row("Destination", data.destination)}
              {row("Vehicles", data.vehicles)}
              {row("1st avail", data.firstAvail ? formatDate(data.firstAvail) : null)}
              {row(
                "Money",
                <span className="tabular-nums">
                  Tariff {formatCurrency(data.tariff)} · Deposit {formatCurrency(data.deposit)}
                  {canSeeMargin && data.carrierPay != null
                    ? ` · Carrier ${formatCurrency(data.carrierPay)}`
                    : ""}
                </span>
              )}
              {data.shipperInfo && row("Info for shipper", data.shipperInfo)}
              {data.notes && row("Notes from shipper", data.notes)}
            </div>

            <div className="mt-2 border-t pt-2">
              <Link
                href={`/loads/${data.loadId}`}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Open full record →
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
