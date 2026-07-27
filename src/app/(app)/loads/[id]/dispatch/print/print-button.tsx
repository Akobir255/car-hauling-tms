"use client";

import { Printer } from "lucide-react";

// Screen-only controls for the dispatch sheet; they disappear when printed.
export function PrintButton() {
  return (
    <div className="mb-4 flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded bg-neutral-800 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-900"
      >
        <Printer className="size-4" aria-hidden="true" />
        Print / Save as PDF
      </button>
      <button
        type="button"
        onClick={() => window.history.back()}
        className="rounded border px-4 py-2 text-sm font-medium hover:bg-neutral-100"
      >
        Back
      </button>
    </div>
  );
}
