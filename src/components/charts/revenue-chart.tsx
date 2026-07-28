"use client";

import { useId, useRef, useState } from "react";

export type RevenuePoint = { date: string; value: number };

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 48 };

// Single-series cumulative revenue line. One hue (brand blue via
// currentColor), recessive grid, crosshair + tooltip on hover, emphasized
// latest point. Values are also exposed as a visually-hidden table.
export function RevenueChart({ points }: { points: RevenuePoint[] }) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Not enough data yet — revenue will chart here as loads come in.
      </p>
    );
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${PAD.left},${(PAD.top + innerH).toFixed(1)} Z`;

  const gridValues = [0.5, 1].map((f) => max * f);
  const money = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;
  const dateLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const tickEvery = Math.ceil(points.length / 5);
  const hovered = hover != null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    // --chart-1 is msgplane's structural blue (#1565c0 / #64b5f6 dark); every
    // other tile on this dashboard drives its color from the chart-* tokens.
    <div className="relative text-chart-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Cumulative revenue over the last 30 days"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-xs tabular-nums"
            >
              {money(v)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          className="stroke-border"
          strokeWidth="1"
        />

        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text
              key={p.date}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-xs"
            >
              {dateLabel(p.date)}
            </text>
          ) : null
        )}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />

        {/* Emphasized latest point */}
        <circle
          cx={x(points.length - 1)}
          cy={y(points[points.length - 1].value)}
          r="4"
          fill="currentColor"
          className="stroke-background"
          strokeWidth="2"
        />

        {hovered && hover != null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-muted-foreground/40"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover)}
              cy={y(hovered.value)}
              r="4.5"
              fill="currentColor"
              className="stroke-background"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {hovered && hover != null && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})`,
          }}
        >
          <p className="text-muted-foreground">{dateLabel(hovered.date)}</p>
          <p className="tabular-nums text-foreground">
            ${hovered.value.toLocaleString("en-US")}
          </p>
        </div>
      )}

      <table className="sr-only">
        <caption>Cumulative revenue by day, last 30 days</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>${p.value.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
