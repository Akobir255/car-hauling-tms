import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// A grouped form section as a banded card: a tinted header bar (primary
// accent + icon + title) over a bordered, padded body. The bar is what
// visually separates one group of fields from the next.
export function FormSection({
  icon: Icon,
  title,
  aside,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-card shadow-sm", className)}>
      <div className="flex items-center gap-2.5 border-b bg-muted/50 px-5 py-3">
        <span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />
        <Icon className="size-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// Field label: uppercase, but big and bold enough to read at a glance —
// 13px semibold, not the old 11px micro type that caused eye strain.
export function FieldLabel({
  htmlFor,
  required,
  className,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "block text-[13px] font-semibold uppercase tracking-wide text-muted-foreground",
        className
      )}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-destructive" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}
