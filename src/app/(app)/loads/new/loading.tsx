// Instant skeleton for the New Load route so clicking "New" gives immediate
// feedback instead of a hang while the server component fetches customers.
// Next streams this in while the page loads.
export default function Loading() {
  return (
    <div className="space-y-8">
      {[0, 1, 2, 3].map((i) => (
        // bg-border, not bg-muted: #fafafa on a white card is a 1.04:1 step, so
        // the bars were invisible and animate-pulse was only modulating the
        // opacity of nothing.
        <div key={i} className="overflow-hidden rounded-md border bg-card">
          <div className="h-11 border-b bg-secondary" />
          <div className="space-y-3 p-5">
            <div className="h-9 w-full animate-pulse rounded-md bg-border" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-9 animate-pulse rounded-md bg-border" />
              <div className="h-9 animate-pulse rounded-md bg-border" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
