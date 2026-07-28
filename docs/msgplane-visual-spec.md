# msgplane visual spec

Measured from the live msgplane app (`usst.msgplane.com`) on 2026-07-27 by
reading computed styles off the rendered Leads/Quotes/Orders lists. Every value
below is observed, not guessed.

msgplane is **Materialize CSS** with the `blue darken-3` primary. It defines no
CSS custom properties — colors are Materialize helper classes plus per-element
inline `style="color:…"`. That is why the status word and the column headers
carry odd one-off colors: they were hardcoded, not themed.

## Type

| Token | Value |
| --- | --- |
| Family | `Lato` (served as `LatoWeb`) |
| Root size | 15px |
| Body size | 12px |
| List rows / cells | 14px |
| Nav items | 15px |
| Weight | 400 throughout; 700 only on "Notes from Shipper" |

## Color

| Surface | Hex | Notes |
| --- | --- | --- |
| Top nav bar | `#1565c0` | Material blue darken-3; 64px tall |
| Nav item text | `#ffffff` | 15px, padding `0 15px` |
| Nav item, active | `rgba(0,0,0,0.1)` | overlay on the blue, not a solid |
| Nav search input | `#6188de` | 3px radius, 30px tall, 16px text |
| Page background | `#ffffff` | flat white — no gray page behind cards |
| Body text | `rgba(0,0,0,0.87)` | Material's ink, not pure black |
| Column headers | `#795548` | Material brown 500 |
| Order ID link | `#039be5` | Material light-blue 600, **no underline** |
| Status word (under ID) | `#cccccc` | same gray for every status |
| Row bottom border | `#e5e5e5` | ~0.91px |
| Row height | ~88px | |
| Tab button | `#ffffff` bg / `#000000` text | 14px, padding `1px 3px`, radius 3px |
| Tab button, selected | `#ee6e73` bg / `#ffffff` text | Materialize's default primary |
| "Notes from Shipper" | `#2196f3` | bold |
| Page search bar | `#f1f3f4` | |
| Muted / secondary text | `#9e9e9e` | |
| Border gray | `#e0e0e0` | |
| Raised surface | `#fafafa` | |

### Row icons

| Icon | Hex |
| --- | --- |
| Assigned-to (`account_box`) | `#795548` brown |
| Shipper (`account_circle`) | `#2196f3` blue |
| Phone | `#000000` |
| Email | `#f44336` red |
| Accent / success | `#26a69a` teal, `#4caf50` green |
| Warning | `#ff9800` orange |

## Shape

Radius is **3px** everywhere — tab buttons, the note counters, the nav search.
Nothing in msgplane is more rounded than that, and nothing carries a shadow
except the nav bar.

## Deliberate departures

Four things are copied in spirit rather than to the pixel, because copying
them exactly would make the app worse:

1. **Status color.** msgplane paints every status the same `#cccccc`, so
   "cancelled" and "picked up" look identical and the gray fails contrast
   against white (1.6:1, against a 4.5:1 requirement). We keep msgplane's gray
   weight and position but let the status carry its own hue.
2. **Dark mode.** msgplane has a Dark toggle; its palette was not sampled,
   because toggling it would have changed a setting on the live account. Ours
   is derived: the same hues, lifted for legibility on a dark surface.
3. **Focus rings.** Materialize drops them in places. We keep ours — the team
   works this app by keyboard all day. The global `outline-ring` runs at full
   opacity because it overrides the browser's own two-tone ring, and hand-rolled
   links and buttons carry an explicit `focus-ring` utility.
5. **Type runs one step larger.** The scale is still three sizes and still
   proportional, but 12/14/15 became 13/15/16. msgplane's 12px was designed for
   a wide desk monitor; on a laptop it is hard work, and this team reads these
   screens all day. Body leading is 1.55 and smoothing is grayscale rather than
   subpixel — Lato at weight 400 renders thin and ragged on Windows otherwise,
   which is where the team works. What makes the app feel like the old system is
   the three-size discipline and the proportions, not the absolute values.
4. **One display size.** msgplane's largest type is the 15px root, because it
   has no dashboard. Ours does, and a KPI value that reads at 15px is not a KPI.
   `text-xl` is the only size above the 12 / 14 / 15 scale, it stays at weight
   400, and it is used in exactly two roles: the stat-tile value and the donut's
   center total. Everything else in the app is on the scale — 10px, 11px and
   13px are not.
