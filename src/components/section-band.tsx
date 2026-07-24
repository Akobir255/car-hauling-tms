import { cn } from "@/lib/utils";

// msgplane-style section: a blue title band over a white body. Used to lay
// the Order detail out exactly like the legacy screens.
export function SectionBand({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-md border", className)}>
      <div className="bg-blue-500 px-4 py-2 text-sm font-semibold text-white dark:bg-blue-700">
        {title}
      </div>
      <div className={cn("bg-card p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

// One "Label: value" line, as they appear stacked in the legacy panels.
export function BandRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <span className="font-semibold">{label}</span>
      <span className={cn("text-right tabular-nums", valueClassName)}>{value}</span>
    </div>
  );
}
