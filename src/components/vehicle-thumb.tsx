import { cn } from "@/lib/utils";
import type { VehicleType } from "@/types/database";

// Vehicle thumbnail by body type — the msgplane list shows a silhouette per
// type (not a per-model photo), so these are drawn inline: no external image
// service, no API key, no broken-image states, and they theme correctly.

function Silhouette({ type }: { type: VehicleType }) {
  const body = "currentColor";
  switch (type) {
    case "suv":
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <path
            d="M4 22V16c0-1 .6-1.8 1.5-2.1l7-2.4 3.8-4.3A3 3 0 0 1 18.6 6h17.8a3 3 0 0 1 2.2 1l4.9 5.4 8.8 1.9c1.6.3 2.7 1.7 2.7 3.3V22H4Z"
            fill={body}
            opacity="0.85"
          />
          <path d="M19 7.5h7v4.5h-11l4-4.5ZM28 7.5h8l4 4.5H28V7.5Z" fill="#fff" opacity="0.55" />
          <circle cx="17" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="17" cy="22" r="1.8" fill="#9ca3af" />
          <circle cx="46" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="46" cy="22" r="1.8" fill="#9ca3af" />
        </svg>
      );
    case "pickup":
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <path
            d="M4 22v-6.5c0-1.4 1-2.6 2.4-2.9l6-1.2 3.4-4.4A3 3 0 0 1 18.2 6h10.3a3 3 0 0 1 3 3v3.6h24a2 2 0 0 1 2 2V22H4Z"
            fill={body}
            opacity="0.85"
          />
          <path d="M18.5 7.6h4.4v4.9h-8.2l3.8-4.9ZM24.6 7.6h3.9a1.4 1.4 0 0 1 1.4 1.4v3.5h-5.3V7.6Z" fill="#fff" opacity="0.55" />
          <circle cx="17" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="17" cy="22" r="1.8" fill="#9ca3af" />
          <circle cx="47" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="47" cy="22" r="1.8" fill="#9ca3af" />
        </svg>
      );
    case "van":
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <path
            d="M5 22V9a3 3 0 0 1 3-3h27.5a3 3 0 0 1 2.4 1.2l7.6 10.2 5.6 1.3c1.7.4 2.9 1.9 2.9 3.6V22H5Z"
            fill={body}
            opacity="0.85"
          />
          <path d="M10 8.5h11v6H10v-6ZM24 8.5h10.5l4.4 6H24v-6Z" fill="#fff" opacity="0.55" />
          <circle cx="18" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="18" cy="22" r="1.8" fill="#9ca3af" />
          <circle cx="46" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="46" cy="22" r="1.8" fill="#9ca3af" />
        </svg>
      );
    case "motorcycle":
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <circle cx="14" cy="21" r="7" stroke={body} strokeWidth="2.5" opacity="0.85" />
          <circle cx="50" cy="21" r="7" stroke={body} strokeWidth="2.5" opacity="0.85" />
          <path
            d="M14 21l7-9h10l4 6h9M31 12l-3-4h-6M43 18l4-6h5"
            stroke={body}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
          <path d="M33 18h12l-2 3H35l-2-3Z" fill={body} opacity="0.85" />
        </svg>
      );
    case "other":
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <rect x="6" y="8" width="44" height="12" rx="2" fill={body} opacity="0.85" />
          <circle cx="17" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="17" cy="22" r="1.8" fill="#9ca3af" />
          <circle cx="42" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="42" cy="22" r="1.8" fill="#9ca3af" />
        </svg>
      );
    default:
      // sedan / car
      return (
        <svg viewBox="0 0 64 32" fill="none" aria-hidden="true" className="size-full">
          <path
            d="M4 22v-4.4c0-1.5 1-2.7 2.4-3.1l8.4-2.2 4.6-3.9A4 4 0 0 1 22 7.4h14.6a4 4 0 0 1 2.6 1l5.4 4.6 8 2c1.6.4 2.8 1.9 2.8 3.6V22H4Z"
            fill={body}
            opacity="0.85"
          />
          <path d="M22.4 8.9h6.2v4.4H17.2l5.2-4.4ZM30.6 8.9h6a2 2 0 0 1 1.3.5l4.6 3.9H30.6V8.9Z" fill="#fff" opacity="0.55" />
          <circle cx="18" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="18" cy="22" r="1.8" fill="#9ca3af" />
          <circle cx="46" cy="22" r="4.5" fill="#1f2937" />
          <circle cx="46" cy="22" r="1.8" fill="#9ca3af" />
        </svg>
      );
  }
}

export function VehicleThumb({
  type,
  className,
}: {
  type: VehicleType | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // rounded-md, not bare `rounded` — the latter is Tailwind's fixed 4px
        // and would not follow --radius, which the spec pins at 3px.
        "flex h-9 w-14 shrink-0 items-center justify-center rounded-md border bg-muted/60 p-1 text-slate-500 dark:text-slate-400",
        className
      )}
    >
      <Silhouette type={(type || "sedan") as VehicleType} />
    </span>
  );
}
