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
  id,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      {/* Solid title bar — each section announces itself, msgplane-style, so
          long forms never read as one undivided sheet. */}
      <div className="flex items-center justify-between gap-3 bg-primary px-5 py-3 text-primary-foreground">
        {/* 15px is the root size, and msgplane letter-spaces nothing. */}
        <h2 className="text-[15px]">{title}</h2>
        {action}
      </div>
      <div className={cn("p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// A labeled value: a small brown label above a readable value. The value is the
// loud element, the label the quiet one. The label is a column header wearing a
// different layout, so it takes the same brown the table headers do.
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
      {/* msgplane has no uppercase, letter-spaced micro-labels anywhere. */}
      <p className="text-xs text-msg-header">{label}</p>
      <div className="text-sm leading-snug text-foreground">{children}</div>
    </div>
  );
}

// One "label … value" line for the money/dates grids. Divider + roomy padding
// so a long column stays scannable.
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
  // whole row so filled dates/amounts are what the eye lands on. The dimmed
  // tier is --muted-foreground, not an opacity step: the old /35 and /45 put
  // real body text at roughly 3:1, under the 4.5:1 floor.
  const empty = value === "—" || value === "" || value == null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-msg-rule py-2 last:border-0">
      <span className={cn("text-sm", empty ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      <span
        className={cn(
          "text-sm tabular-nums",
          empty ? "text-muted-foreground" : "text-foreground",
          valueClassName
        )}
      >
        {empty ? "—" : value}
      </span>
    </div>
  );
}
