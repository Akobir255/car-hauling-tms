// A faint diagonal strip of "who is looking at this screen" tiled across the
// whole viewport. Attribution, not prevention: it does not stop anyone
// photographing a load's contact details, it makes the photograph say who did.
//
// Three things this must never do, in the order they are easy to get wrong:
//   1. swallow a click — pointer-events: none, inherited by every row inside;
//   2. reach a screen reader — aria-hidden, since 14 lines of the same string
//      is exactly the noise that makes people switch the reader off;
//   3. move anything — position: fixed contributes nothing to layout, and its
//      own overflow-hidden clips the overspill instead of growing the page.
//
// COLOUR AND PRINT BEHAVIOUR LIVE IN globals.css, in the block next to the
// --watermark-ink tokens. They belong there for the same reason every other
// colour in this app does — light/dark are two values of one token — and
// because the print rules have to be real @media print CSS, not a utility.
// This file is geometry and text.

// How many lines down, and how many copies of the label across each line.
//
// Both round UP on purpose. Over-covering is free — the overflow-hidden above
// clips it — while under-covering leaves a bare corner, and a bare corner is a
// crop that carries no attribution at all. The line has to span the layer,
// whose widest is calc(87vw + 51vh) = 4442px at 3840x2160, and ROWS is set so
// the on-screen spacing between lines lands between ~85px on a laptop and
// ~280px on that 4K panel.
//
// REPEATS_PER_ROW is sized against the SHORTEST label buildWatermarkLabel can
// emit, not a typical one — the label is per-user and the copy count is not.
// Measured in a browser against the real compiled stylesheet: a typical line
// ("Leo Toshev · leo@usstrucking.org · …") is ~432px per copy, but the floor
// ("unknown user · <day> · IP unknown · SID unknown", what a profile with no
// full_name and no email behind a proxy that sends no x-forwarded-for gets) is
// ~310px, and a real short one ("Ann Lee · ann@usst.com · …") ~363px. At 12
// copies those two fall 724px and 88px short of the 4K layer — bare ends on
// every row, i.e. exactly the uncovered corner this sizing exists to prevent,
// on the accounts least likely to be looked at closely. 16 × 310px = 4960px
// clears the widest layer for every label the builder can produce.
const ROWS = 14;
const REPEATS_PER_ROW = 16;

// Non-breaking, because `white-space: nowrap` still collapses runs of ordinary
// spaces and the copies would run together into one unreadable smear.
const GAP = "\u00a0\u00a0\u00a0\u00a0";

export function SessionWatermark({ label }: { label: string }) {
  const line = Array.from({ length: REPEATS_PER_ROW }, () => label).join(GAP);

  return (
    <div
      // The attribute, not a class, is the handle globals.css and the tests
      // hold onto — a Tailwind class here would be one refactor away from
      // silently unstyling the whole overlay.
      data-session-watermark=""
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden text-[12px] leading-none tracking-wide select-none"
    >
      {/* The rotated layer, centred on the viewport.
          A layer turned by 30 degrees has to be BIGGER than the viewport to
          still cover its corners, and how much bigger depends on the aspect
          ratio, not on a fixed percentage: a w x h viewport needs
          (w·cos30 + h·sin30) by (w·sin30 + h·cos30), i.e. these two calcs with
          the cosine and sine rounded up for slack. The obvious version —
          inset-[-25%], a flat 150% of each side — is short in EVERY landscape
          shape this team uses; measured on 1440x900, it left the top-left
          corner 75px clear of the nearest line.
          justify-between rather than a fixed gap so the lines spread to
          whatever height that works out to, instead of bunching at the top. */}
      <div className="absolute top-1/2 left-1/2 flex h-[calc(51vw_+_87vh)] w-[calc(87vw_+_51vh)] -translate-x-1/2 -translate-y-1/2 flex-col justify-between rotate-[-30deg]">
        {Array.from({ length: ROWS }, (_, row) => (
          // Every other row steps sideways so the copies form a brick pattern
          // rather than a column grid — a grid leaves clean vertical alleys
          // that a crop can sit between.
          <div key={row} className="text-center whitespace-nowrap odd:-translate-x-24">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
