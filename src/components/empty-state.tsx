import type { LucideIcon } from "lucide-react";

// Consistent empty state: quiet icon, clear title, optional hint/CTA.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {/* --msg-hover, not --muted: the plate has no border, so a 1.04:1 fill
          would leave the icon floating on plain white. */}
      <span className="flex size-12 items-center justify-center rounded-md bg-msg-hover text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <p className="text-[15px]">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
