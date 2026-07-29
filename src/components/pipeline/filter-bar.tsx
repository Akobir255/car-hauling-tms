"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Filter, X } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

// Filters that narrow a list to a workable set — who opted out, whose
// paperwork is signed, who has documents on file. Everything lives in the
// URL, so a filtered view can be bookmarked or shared, and "select all"
// selects exactly what is on screen.
export type FilterValues = {
  optout?: string;
  signed?: string;
  docs?: string;
  vehicles?: string;
  age?: string;
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
  // Finds the graveyard: quotes old enough that whoever the shipper went with
  // has already had their chance. Combine with Messaging → "Contactable" and
  // the selection feeds straight into bulk email.
  {
    key: "age",
    label: "Age",
    options: [
      { value: "", label: "Any" },
      { value: "30", label: "Older than 30 days" },
      { value: "90", label: "Older than 90 days" },
      { value: "180", label: "Older than 6 months" },
      { value: "365", label: "Older than a year" },
    ],
  },
];

export function FilterBar({ values, matched }: { values: FilterValues; matched: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = FILTERS.filter((f) => values[f.key]);
  // Mobile only: each label+select group needs ~205-285px, so all four wrap to
  // their own line and the filter chrome buries the list before a single
  // record is visible. Desktop never reads this — the group wrapper is
  // display:contents at md.
  const [open, setOpen] = useState(false);

  // Narrowing 400 records to 12 while sitting on page 3 asks for rows 300-399
  // of a 12-row result and renders an empty table. Any filter change goes back
  // to page one.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`?${next.toString()}`);
  };

  const clearAll = () => {
    const next = new URLSearchParams(params.toString());
    FILTERS.forEach((f) => next.delete(f.key));
    next.delete("page");
    router.push(next.toString() ? `?${next.toString()}` : "?");
  };

  // msgplane's page search bar is a flat #f1f3f4 fill with no edge — the
  // borderless tint is what marks this row as chrome rather than content.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-msg-rail px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Filter className="size-3.5" aria-hidden="true" />
        Filter
      </span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring -my-2 inline-flex min-h-12 items-center gap-1 text-muted-foreground hover:text-foreground md:hidden"
      >
        {active.length > 0 ? `${active.length} set` : "none set"}
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {/* md:contents removes this box from the layout entirely at >=768px, so
          the four labels stay direct flex children of the bar with the bar's
          own gaps — the desktop row is the same row it always was. */}
      <div
        className={cn(
          "w-full flex-wrap items-center gap-x-4 gap-y-2 md:contents",
          open ? "flex" : "hidden"
        )}
      >
        {FILTERS.map((f) => (
          <label key={f.key} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{f.label}</span>
            {/* No text-sm here: the base class is text-[16px] md:text-sm, and
                tailwind-merge would drop the 16px step that keeps mobile
                Safari from zooming the viewport on focus. */}
            <NativeSelect
              aria-label={f.label}
              value={values[f.key] ?? ""}
              onChange={(e) => setParam(f.key, e.target.value)}
              className="h-12 w-auto min-w-32 md:h-[30px]"
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        ))}
      </div>

      {active.length > 0 && (
        <>
          <span className="tabular-nums text-muted-foreground">{matched} matching</span>
          <button
            type="button"
            onClick={clearAll}
            className="focus-ring -my-2 inline-flex min-h-12 items-center gap-1 text-muted-foreground hover:text-foreground md:my-0 md:min-h-0"
          >
            <X className="size-3.5" aria-hidden="true" />
            clear
          </button>
        </>
      )}
    </div>
  );
}
