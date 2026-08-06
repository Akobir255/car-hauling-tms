// Business-day boundaries. "Due today" must mean the same thing everywhere —
// the dashboard card, the Follow-up Today tabs, and their counts — and it must
// be anchored to the business timezone, not the server's. Vercel runs in UTC
// and the team works from UTC+5, so `new Date().setHours(23,59,59)` gives a
// different boundary in prod than in dev and cuts off US-evening follow-ups.

const BUSINESS_TZ = (process.env.BUSINESS_TIMEZONE || "America/New_York").trim();

// Minutes the given IANA zone is ahead of UTC at the given instant.
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

// Today's calendar date in the business timezone, as YYYY-MM-DD. en-CA is
// what produces that shape without hand-assembling parts. Exported because the
// session watermark stamps a date onto every screen and it has to be the same
// "today" the follow-up queues use, not the server's UTC one.
export function businessDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// The instant at which "today" ends (23:59:59.999) in the business timezone.
export function endOfBusinessDay(now: Date = new Date()): Date {
  const [y, m, d] = businessDay(now).split("-").map(Number);

  // Guess assuming the current offset, then correct once in case the guess
  // lands across a DST transition.
  let guess = new Date(
    Date.UTC(y, m - 1, d, 23, 59, 59, 999) - tzOffsetMinutes(BUSINESS_TZ, now) * 60_000
  );
  guess = new Date(
    Date.UTC(y, m - 1, d, 23, 59, 59, 999) - tzOffsetMinutes(BUSINESS_TZ, guess) * 60_000
  );
  return guess;
}

// N days before now, as an ISO instant. Lives here rather than inline in a
// component because reading the clock during render is impure — the same
// reason endOfBusinessDay() is a call at the top of a component and not an
// expression buried in a query builder.
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
