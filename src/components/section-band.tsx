import { cn } from "@/lib/utils";

// A section panel: a calm tinted header with a small primary accent, over a
// card body. Deliberately quiet — the data inside should read louder than the
// header. All color comes from theme tokens so light/dark stay consistent.
export function SectionBand({
  title,
  children,
  className,
  bodyClassName,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-5 py-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground">
          <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

// A labeled value: a small muted uppercase label above a readable value. The
// value is the loud element, the label the quiet one.
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-[15px] leading-snug text-foreground">{children}</div>
    </div>
  );
}

// One "label … value" line for the money/dates grids. Divider + roomy padding
// so a long column stays scannable; the value is bold and dark, the label muted.
export function BandRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  // Empty fields ("—") shouldn't carry the same weight as real data — dim the
  // whole row so filled dates/amounts are what the eye lands on.
  const empty = value === "—" || value === "" || value == null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className={cn("text-sm", empty ? "text-foreground/45" : "text-foreground")}>{label}</span>
      <span
        className={cn(
          "text-sm tabular-nums",
          empty ? "font-normal text-foreground/35" : "font-semibold text-foreground",
          valueClassName
        )}
      >
        {empty ? "—" : value}
      </span>
    </div>
  );
}
