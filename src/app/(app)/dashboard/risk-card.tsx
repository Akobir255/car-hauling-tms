"use client";

import { Component, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acknowledgeRiskFactor, snoozeLoadRisk } from "./risk-actions";

// The Needs-attention card, now with the two buttons that keep an alerting
// feature alive: "Handled" acknowledges the row's worst factor, "Snooze 3d"
// quiets the whole order. Props are plain serialisable rows — the scoring and
// every query stay in the server component.

export type RiskCardItem = {
  id: string;
  loadNumber: string | null;
  band: "low" | "watch" | "high";
  /** The worst factor's stand-up sentence. */
  detail: string | null;
  /** The worst factor's key — what "Handled" acknowledges. */
  worstFactor: string | null;
  /** How many further factors the order carries beyond the worst. */
  extraCount: number;
};

// This card must never take the dashboard down: it is an advisory panel, not
// the page. The data half already fails soft in the server component; this
// boundary is the render half of the same promise.
class RiskCardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("Needs-attention card failed to render:", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function RiskRow({ item }: { item: RiskCardItem }) {
  const [pending, start] = useTransition();

  const handled = () =>
    start(async () => {
      if (!item.worstFactor) return;
      const r = await acknowledgeRiskFactor(item.id, item.worstFactor);
      if (r.error) toast.error(r.error);
      else toast.success(`${item.loadNumber ?? "Order"} — marked handled.`);
    });

  const snooze = () =>
    start(async () => {
      const r = await snoozeLoadRisk(item.id, 3);
      if (r.error) toast.error(r.error);
      else toast.success(`${item.loadNumber ?? "Order"} — quiet for 3 days.`);
    });

  return (
    <div className="rounded-md px-2 py-1.5 text-sm hover:bg-msg-hover">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/loads/${item.id}`} className="min-w-0">
          <span className="tabular-nums text-msg-link">{item.loadNumber}</span>
          {/* The worst factor only. A stacked list of five worries per order is
              a wall nobody reads; the rest are on the order itself. */}
          <span className="block truncate text-xs text-muted-foreground">
            {item.detail}
            {item.extraCount > 0 && ` · +${item.extraCount} more`}
          </span>
        </Link>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide",
            item.band === "high"
              ? "bg-ord-deposit-bg text-ord-deposit"
              : "bg-ord-chip text-ord-head"
          )}
        >
          {item.band === "high" ? "urgent" : "watch"}
        </span>
      </div>
      <div className="mt-1 flex gap-1.5">
        <button
          type="button"
          onClick={handled}
          disabled={pending || !item.worstFactor}
          className="focus-ring rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-msg-hover hover:text-foreground disabled:opacity-50"
        >
          Handled
        </button>
        <button
          type="button"
          onClick={snooze}
          disabled={pending}
          className="focus-ring rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-msg-hover hover:text-foreground disabled:opacity-50"
        >
          Snooze 3d
        </button>
      </div>
    </div>
  );
}

export function RiskCard({ items, total }: { items: RiskCardItem[]; total: number }) {
  return (
    <RiskCardBoundary>
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <TriangleAlert className="size-4 text-ord-deposit" aria-hidden="true" />
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {items.map((item) => (
            <RiskRow key={item.id} item={item} />
          ))}
          {total > items.length && (
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              and {total - items.length} more
            </p>
          )}
        </CardContent>
      </Card>
    </RiskCardBoundary>
  );
}
