"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SquareArrowOutUpRight, X } from "lucide-react";
import { formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { statusTone } from "./status-tone";

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

  // `emphatic` is the one label msgplane sets apart — see the call below.
  const row = (label: string, value: React.ReactNode, emphatic = false) => (
    <div className="flex gap-3 border-b border-msg-rule py-1.5 last:border-0">
      <span
        className={cn(
          "w-28 shrink-0",
          emphatic ? "font-bold text-msg-link" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{value ?? "—"}</span>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setPos(null) : place())}
        className="focus-ring flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
        quick view
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          {/* No shadow anywhere but the nav bar, so the popup separates on the
              border gray — the same device the list container uses. */}
          <div
            className="fixed z-50 w-[420px] rounded-md border bg-popover p-3 text-sm"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="mb-2 flex items-center gap-2 border-b pb-2">
              <Link
                href={`/loads/${data.loadId}`}
                className="tabular-nums text-msg-link"
              >
                {data.loadNumber}
              </Link>
              <span className={cn("lowercase", statusTone(data.status))}>{data.status}</span>
              <button
                type="button"
                onClick={() => setPos(null)}
                aria-label="Close quick view"
                className="focus-ring ml-auto text-muted-foreground hover:text-foreground"
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
              {/* The one label the spec sets at 700; the edit form renders the
                  same string the same way. msgplane paints it #2196f3, which
                  is 3.1:1 as text — msg-link is the same blue family at 4.8:1
                  and the weight is what carries the emphasis anyway. */}
              {data.notes && row("Notes from Shipper", data.notes, true)}
            </div>

            <div className="mt-2 border-t pt-2">
              <Link
                href={`/loads/${data.loadId}`}
                className="text-[12px] text-msg-link"
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
