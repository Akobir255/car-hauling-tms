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
    // No shadow: the nav bar is the only raised surface in msgplane, so the
    // border gray is what makes a section read as a box. Matches SectionBand,
    // which renders the same chrome on the load-detail screens.
    <section className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      {/* Solid title bar — each field group announces itself, msgplane-style,
          so a long form never reads as one undivided sheet. */}
      <div className="flex items-center gap-2.5 bg-primary px-5 py-2.5 text-primary-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {/* 15px is the root size, and msgplane letter-spaces nothing. */}
        <h2 className="text-[15px]">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// Field label: the same quiet brown micro-label SectionBand's Field uses, so
// the new-load form and the load-detail screens agree. msgplane has no
// uppercase, letter-spaced labels anywhere — and `uppercase` in particular is
// something tailwind-merge cannot cancel from a caller's className, which is
// how "Notes from Shipper" ended up shouting on the edit form only.
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
      className={cn("block text-xs text-msg-header", className)}
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
