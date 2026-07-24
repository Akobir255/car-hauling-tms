import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

// KPI stat tile: value is the hero, icon in a tinted chip, delta as
// arrow + signed percentage (icon + text, never color alone).
export function StatCard({
  title,
  value,
  icon: Icon,
  iconClass,
  delta,
  deltaLabel = "vs prior 7 days",
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  iconClass: string;
  delta?: number | null;
  deltaLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", iconClass)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {delta != null && (
          <p className="flex items-center gap-1 text-xs">
            {delta >= 0 ? (
              <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                {delta}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 font-medium text-red-700 dark:text-red-400">
                <ArrowDownRight className="size-3.5" aria-hidden="true" />
                {Math.abs(delta)}%
              </span>
            )}
            <span className="text-muted-foreground">{deltaLabel}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
