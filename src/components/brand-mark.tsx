// The US Star Trucking mark, drawn rather than loaded.
//
// Inline SVG on purpose: the signing page is emailed to customers and printed
// by some of them, and a vector mark stays sharp at any size with no asset to
// 404. It also means the contract has no external image request, which is one
// less thing for a mail client to strip or a privacy blocker to flag.
//
// This is a REDRAW from the logo the owner sent, not the original file. The
// proportions and the blue are matched by eye. If the real artwork turns up,
// swap the <path> here and everything using it follows — that is the whole
// reason it is one component rather than an <img> repeated across pages.
export const BRAND_BLUE = "#0B5CAB";

// Five-point star, outer radius 42 / inner 16 on a 100 box — long points and a
// small core, which is what makes it read as a star rather than a pentagon.
const STAR =
  "M50 8 L59.4 37.06 L89.95 37.02 L65.22 54.94 L74.69 83.98 " +
  "L50 66 L25.31 83.98 L34.78 54.94 L10.05 37.02 L40.6 37.06 Z";

/** The square badge — star reversed out of the brand blue. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="US Star Trucking">
      <rect width="100" height="100" rx="14" fill={BRAND_BLUE} />
      <path d={STAR} fill="#fff" />
    </svg>
  );
}

/** Just the star, taking its colour from the surrounding text. */
export function BrandStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={STAR} fill="currentColor" />
    </svg>
  );
}

/** Badge plus the stacked wordmark, as the owner's artwork sets it. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={className}>
      <BrandMark className="size-11 shrink-0" />
      <span className="text-[17px] font-semibold leading-[1.15] tracking-tight">
        US Star
        <br />
        Trucking
      </span>
    </span>
  );
}
