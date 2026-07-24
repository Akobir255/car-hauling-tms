// Instant skeleton for the New Load route so clicking "New" gives immediate
// feedback instead of a hang while the server component fetches customers.
// Next streams this in while the page loads.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="h-11 border-b bg-muted/50" />
          <div className="space-y-3 p-5">
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-9 animate-pulse rounded bg-muted" />
              <div className="h-9 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
