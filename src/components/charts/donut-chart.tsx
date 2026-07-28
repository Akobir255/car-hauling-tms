"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type DonutSegment = {
  label: string;
  value: number;
  // Validated categorical slot as a Tailwind text-* class pair; the SVG
  // paints with currentColor so light/dark steps come from the class.
  colorClass: string;
};

const SIZE = 160;
const R = 62;
const STROKE = 16;
const GAP_PX = 2;

// Composition donut: thin ring, 2px surface gaps between segments, total in
// the middle. Identity is never color-alone — the legend rows carry every
// label and value as text.
export function DonutChart({
  segments,
  totalLabel,
}: {
  segments: DonutSegment[];
  totalLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);

  if (total === 0) {
    return (
      <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No vehicles yet.
      </p>
    );
  }

  const C = 2 * Math.PI * R;
  const offsets: number[] = [];
  for (let i = 0, acc = 0; i < segments.length; i++) {
    offsets.push(acc);
    acc += (segments[i].value / total) * C;
  }

  return (
    <div className="flex flex-wrap items-center gap-6">
      {/* mx-auto, not basis-full: the absolutely-positioned total below is
          inset-0 on this box, so widening it would move the total off the
          ring. The legend is what forces the wrap. */}
      <div className="relative shrink-0 max-md:mx-auto">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`${totalLabel}: ${total} across ${segments.length} types`}
        >
          {segments.map((seg, i) => {
            const frac = seg.value / total;
            const len = Math.max(frac * C - GAP_PX, 1);
            const dashOffset = -offsets[i];
            return (
              <circle
                key={seg.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={hover === i ? STROKE + 3 : STROKE}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                className={cn("transition-all", seg.colorClass)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {/* Weight 400 at the one display size the spec allows itself — see
              departure #4; the ring around it is already the emphasis. */}
          <p className="text-xl tabular-nums">{total}</p>
          <p className="text-xs text-muted-foreground">{totalLabel}</p>
        </div>
      </div>

      {/* flex-wrap never engaged: the ring is shrink-0 and the legend just
          squeezed, down to ~29px for the label — a single letter and an
          ellipsis, which leaves the chart identified by colour alone. Taking
          the full row below md restores the labels the comment above promises. */}
      <ul className="min-w-0 flex-1 space-y-1.5 max-md:basis-full">
        {segments.map((seg, i) => (
          <li
            key={seg.label}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm transition-colors",
              hover === i && "bg-msg-hover"
            )}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className={cn("size-2.5 shrink-0 rounded-full bg-current", seg.colorClass)} aria-hidden="true" />
            <span className="truncate">{seg.label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {seg.value} ({Math.round((seg.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
