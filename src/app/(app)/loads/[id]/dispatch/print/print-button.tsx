"use client";

import { Printer } from "lucide-react";

// Screen-only controls for the dispatch sheet; they disappear when printed.
export function PrintButton() {
  return (
    <div className="mb-4 flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm text-background hover:opacity-90"
      >
        <Printer className="size-4" aria-hidden="true" />
        Print / Save as PDF
      </button>
      <button
        type="button"
        onClick={() => window.history.back()}
        className="rounded-md border px-4 py-2 text-sm hover:bg-msg-hover"
      >
        Back
      </button>
    </div>
  );
}
