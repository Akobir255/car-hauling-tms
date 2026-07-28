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
          <p className="text-sm text-msg-header">{title}</p>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", iconClass)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
        {/* Weight 400 at the app's one display size — see the spec's departure
            #4. msgplane has no dashboard and so no type above its 15px root. */}
        <p className="text-xl tabular-nums">{value}</p>
        {delta != null && (
          <p className="flex items-center gap-1 text-xs">
            {delta >= 0 ? (
              // Material green 800 / green 300. The spec's #4caf50 is an icon
              // color at 2.8:1 and this is text.
              <span className="inline-flex items-center gap-0.5 text-[#2e7d32] dark:text-[#81c784]">
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                {delta}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-destructive">
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
