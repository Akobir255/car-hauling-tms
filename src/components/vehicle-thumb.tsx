import { cn } from "@/lib/utils";
import type { VehicleType } from "@/types/database";

// Vehicle thumbnail by body type, shown when the make/model photo lookup has
// nothing to show — a blank make, or a model Wikipedia does not carry.
//
// These are drawn in three-quarter view rather than flat profile so they read
// as a vehicle at 56px instead of as a shape. They are deliberately
// ILLUSTRATIONS and not stock photographs: the fallback fires precisely when
// the real vehicle is unknown, and a photograph of some other Accord invites a
// dispatcher to describe a car nobody has seen. A drawing cannot be mistaken
// for the vehicle on the order.
//
// Inline SVG, no image service: no API key, no broken-image state, and the
// body colour follows currentColor so they theme with everything else.

const GLASS = "#dbeafe";
const GLASS_DARK = "#93a9c9";
const TYRE = "#1f2937";
const RIM = "#9ca3af";
const SHADOW = "#0f172a";

function Wheels({ x1, x2, y = 36, r = 5.5 }: { x1: number; x2: number; y?: number; r?: number }) {
  return (
    <>
      <ellipse cx={x1} cy={y} rx={r} ry={r} fill={TYRE} />
      <ellipse cx={x1} cy={y} rx={r * 0.42} ry={r * 0.42} fill={RIM} />
      <ellipse cx={x2} cy={y} rx={r} ry={r} fill={TYRE} />
      <ellipse cx={x2} cy={y} rx={r * 0.42} ry={r * 0.42} fill={RIM} />
    </>
  );
}

function Silhouette({ type }: { type: VehicleType }) {
  const body = "currentColor";
  switch (type) {
    case "suv":
      // Tall greenhouse, near-vertical tailgate, visible roof plane — the
      // three cues that separate an SUV from a car at thumbnail size.
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="30" ry="3" fill={SHADOW} opacity="0.12" />
          <path d="M14 36V22.5c0-1.6 1-3 2.5-3.5l6-2 5-8A5 5 0 0 1 32 6h22a5 5 0 0 1 4 2l6.5 9.5 5.5 2c1.8.7 3 2.4 3 4.3V36H14Z" fill={body} opacity="0.9" />
          <path d="M31 8.5h10v9H24.5l6.5-9Z" fill={GLASS} />
          <path d="M44 8.5h9.5a2 2 0 0 1 1.7.9l5.3 7.6H44V8.5Z" fill={GLASS} />
          <path d="M60 17h4l2.5 1H60v-1Z" fill={GLASS_DARK} opacity="0.6" />
          <path d="M14 27h54v2.5H14V27Z" fill={SHADOW} opacity="0.14" />
          <rect x="65.5" y="21" width="3.5" height="3" rx="1" fill="#fef3c7" />
          <Wheels x1={26} x2={58} />
        </svg>
      );
    case "pickup":
      // Cab forward, open bed behind, bed rail line drawn — without the rail
      // the shape reads as a van.
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="31" ry="3" fill={SHADOW} opacity="0.12" />
          <path d="M12 36V24c0-1.7 1.2-3.2 2.9-3.6l6.1-1.4 5-8.5A5 5 0 0 1 30.3 8h13.4a4 4 0 0 1 4 4v9.5H70a3 3 0 0 1 3 3V36H12Z" fill={body} opacity="0.9" />
          <path d="M30.5 10.5h7v8.5H23l7.5-8.5Z" fill={GLASS} />
          <path d="M40.5 10.5h3.2a1.8 1.8 0 0 1 1.8 1.8v6.7h-5V10.5Z" fill={GLASS} />
          <path d="M47.5 22.5H73v2H47.5v-2Z" fill={SHADOW} opacity="0.18" />
          <path d="M12 28h61v2.5H12V28Z" fill={SHADOW} opacity="0.12" />
          <rect x="8.5" y="23" width="3.5" height="3" rx="1" fill="#fef3c7" />
          <Wheels x1={25} x2={60} />
        </svg>
      );
    case "van":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="30" ry="3" fill={SHADOW} opacity="0.12" />
          <path d="M13 36V14a5 5 0 0 1 5-5h27a5 5 0 0 1 4 2l10 13.5 4.5 1.6c1.9.7 3.2 2.5 3.2 4.5V36H13Z" fill={body} opacity="0.9" />
          <path d="M18.5 12h13v10h-13V12Z" fill={GLASS} />
          <path d="M35 12h9.5l7.3 10H35V12Z" fill={GLASS} />
          <path d="M13 27h53.5v2.5H13V27Z" fill={SHADOW} opacity="0.12" />
          <Wheels x1={25} x2={57} />
        </svg>
      );
    case "motorcycle":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="42" rx="26" ry="2.5" fill={SHADOW} opacity="0.12" />
          <circle cx="19" cy="31" r="9" stroke={body} strokeWidth="3" opacity="0.9" />
          <circle cx="61" cy="31" r="9" stroke={body} strokeWidth="3" opacity="0.9" />
          <path d="M19 31l9-12h13l5 8h11M41 19l-4-5h-8M53 27l5-8h6" stroke={body} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          <path d="M40 26h16l-2.5 4H42.5L40 26Z" fill={body} opacity="0.9" />
        </svg>
      );
    case "boat":
      // Hull in three-quarter, windshield raked forward, waterline drawn.
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <path d="M8 24h62l-7 11a4 4 0 0 1-3.3 1.8H18.5A4 4 0 0 1 15 35L8 24Z" fill={body} opacity="0.9" />
          <path d="M26 23V12.5a2.5 2.5 0 0 1 2.5-2.5h15a2.5 2.5 0 0 1 2.1 1.2L52 23H26Z" fill={body} opacity="0.9" />
          <path d="M30 13h12l4.5 7.5H30V13Z" fill={GLASS} />
          <path d="M8 26.5h62l-1.4 2.2H9.3L8 26.5Z" fill={SHADOW} opacity="0.15" />
          <path d="M4 33c4 2 7.5 2 11.5 0M64 33c4 2 7.5 2 11.5 0" stroke={body} strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        </svg>
      );
    case "rv":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="32" ry="3" fill={SHADOW} opacity="0.12" />
          <path d="M8 36V10a2 2 0 0 1 2-2h40a2 2 0 0 1 2 2v7l9.5 2a4 4 0 0 1 3 3.9V36H8Z" fill={body} opacity="0.9" />
          <path d="M12 11.5h15v7H12v-7ZM31 11.5h16v7H31v-7Z" fill={GLASS} />
          <path d="M53.5 20h5.5a2 2 0 0 1 1.9 1.4l1.4 4h-8.8V20Z" fill={GLASS} />
          <path d="M8 27.5h56.5V30H8v-2.5Z" fill={SHADOW} opacity="0.12" />
          <Wheels x1={22} x2={55} />
        </svg>
      );
    case "atv":
      // Oversized knobbly tyres and a short body — that ratio is the only
      // thing separating an ATV from a small car at this size.
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="42" rx="27" ry="2.5" fill={SHADOW} opacity="0.12" />
          <path d="M17 31v-5a3 3 0 0 1 2.4-2.9l8.6-1.7 4-5A4 4 0 0 1 35.2 15h9.6a4 4 0 0 1 3.1 1.5l4.3 5.2 8.4 1.7A3 3 0 0 1 63 26.4V31H17Z" fill={body} opacity="0.9" />
          <path d="M36 17.5h8.5l3.4 4.5H32.4l3.6-4.5Z" fill={GLASS} />
          <path d="M27 22l-4-6M53 22l4-6" stroke={body} strokeWidth="2.6" strokeLinecap="round" opacity="0.9" />
          <Wheels x1={20} x2={60} y={33} r={8} />
        </svg>
      );
    case "trailer":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="44" cy="41" rx="26" ry="3" fill={SHADOW} opacity="0.12" />
          <rect x="20" y="11" width="50" height="20" rx="2" fill={body} opacity="0.9" />
          <path d="M25 15h18v11H25V15Z" fill={GLASS} opacity="0.45" />
          <path d="M20 26.5h50V29H20v-2.5Z" fill={SHADOW} opacity="0.14" />
          <path d="M20 27H10a1.5 1.5 0 0 1 0-3h10" stroke={body} strokeWidth="3" strokeLinecap="round" opacity="0.9" />
          <circle cx="7" cy="25.5" r="3" stroke={body} strokeWidth="2.4" opacity="0.75" />
          <Wheels x1={36} x2={56} />
        </svg>
      );
    case "heavy_equipment":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="42" rx="28" ry="2.5" fill={SHADOW} opacity="0.12" />
          <path d="M26 32V16a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v16H26Z" fill={body} opacity="0.9" />
          <path d="M30 17h11v8H30v-8Z" fill={GLASS} />
          <path d="M46 20l15 6" stroke={body} strokeWidth="3.6" strokeLinecap="round" opacity="0.9" />
          <path d="M60 23h11v9H60a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 60 23Z" fill={body} opacity="0.9" />
          <Wheels x1={22} x2={47} y={33} r={8.5} />
        </svg>
      );
    case "other":
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="28" ry="3" fill={SHADOW} opacity="0.12" />
          <rect x="14" y="14" width="50" height="18" rx="2.5" fill={body} opacity="0.9" />
          <path d="M14 27h50v2.5H14V27Z" fill={SHADOW} opacity="0.14" />
          <Wheels x1={26} x2={54} />
        </svg>
      );
    default:
      // sedan / car — long bonnet, raked screen, roofline dropping to a boot.
      return (
        <svg viewBox="0 0 80 48" fill="none" aria-hidden="true" className="size-full">
          <ellipse cx="40" cy="41" rx="31" ry="3" fill={SHADOW} opacity="0.12" />
          <path d="M8 36v-7.5c0-2 1.4-3.7 3.3-4.2l10.4-2.6 6.6-6.4A7 7 0 0 1 33.2 13h16.4a7 7 0 0 1 4.6 1.7l7.6 6.6 9.4 2.4c2 .5 3.4 2.3 3.4 4.4V36H8Z" fill={body} opacity="0.9" />
          <path d="M33.8 15.6h7.9v6.4H26.6l7.2-6.4Z" fill={GLASS} />
          <path d="M44.6 15.6h5.2a3 3 0 0 1 2 .7l6.2 5.7H44.6v-6.4Z" fill={GLASS} />
          <path d="M8 28.5h66V31H8v-2.5Z" fill={SHADOW} opacity="0.12" />
          <rect x="70.5" y="25" width="3.5" height="3" rx="1" fill="#fef3c7" />
          <Wheels x1={23} x2={59} />
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
