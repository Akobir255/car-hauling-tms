"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Filter, X } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";

// Filters that narrow a list to a workable set — who opted out, whose
// paperwork is signed, who has documents on file. Everything lives in the
// URL, so a filtered view can be bookmarked or shared, and "select all"
// selects exactly what is on screen.
export type FilterValues = {
  optout?: string;
  signed?: string;
  docs?: string;
  vehicles?: string;
};

const FILTERS: {
  key: keyof FilterValues;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "optout",
    label: "Messaging",
    options: [
      { value: "", label: "Anyone" },
      { value: "none", label: "Contactable (no opt-out)" },
      { value: "any", label: "Opted out (any)" },
      { value: "sms", label: "Opted out of SMS" },
      { value: "email", label: "Opted out of email" },
      { value: "blacklisted", label: "Blacklisted" },
    ],
  },
  {
    key: "signed",
    label: "Paperwork",
    options: [
      { value: "", label: "Any" },
      { value: "yes", label: "Signed" },
      { value: "sent", label: "Sent, not signed" },
      { value: "no", label: "Never sent" },
    ],
  },
  {
    key: "docs",
    label: "Documents",
    options: [
      { value: "", label: "Any" },
      { value: "yes", label: "Has files" },
      { value: "no", label: "No files" },
    ],
  },
  {
    key: "vehicles",
    label: "Vehicle",
    options: [
      { value: "", label: "Any" },
      { value: "enclosed", label: "Enclosed only" },
      { value: "nonrunning", label: "Non-running" },
    ],
  },
];

export function FilterBar({ values, matched }: { values: FilterValues; matched: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = FILTERS.filter((f) => values[f.key]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`?${next.toString()}`);
  };

  const clearAll = () => {
    const next = new URLSearchParams(params.toString());
    FILTERS.forEach((f) => next.delete(f.key));
    router.push(next.toString() ? `?${next.toString()}` : "?");
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <Filter className="size-3.5" aria-hidden="true" />
        Filter
      </span>

      {FILTERS.map((f) => (
        <label key={f.key} className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{f.label}</span>
          <NativeSelect
            aria-label={f.label}
            value={values[f.key] ?? ""}
            onChange={(e) => setParam(f.key, e.target.value)}
            className="h-8 w-auto min-w-32 text-sm"
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      ))}

      {active.length > 0 && (
        <>
          <span className="tabular-nums text-muted-foreground">{matched} matching</span>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <X className="size-3.5" aria-hidden="true" />
            clear
          </button>
        </>
      )}
    </div>
  );
}
