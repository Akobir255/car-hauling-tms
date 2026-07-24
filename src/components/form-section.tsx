import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// msgplane-style grouped form sections, modernized: instead of the old
// saturated header bands, a small brand-accent icon + title over a hairline
// divider. The data stays the loudest thing on screen.
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
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 border-b pb-2">
        <Icon className="size-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// Uppercase-tracked micro label; the field VALUE gets the visual weight.
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
        "block text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
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
