"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";

// msgplane's top-right rep filter on every list: My | All | <each rep>.
// Managers only — sales are already scoped to their own records by RLS.
export function RepSelect({
  reps,
  current,
  profileId,
}: {
  reps: { id: string; name: string }[];
  current?: string;
  profileId: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <NativeSelect
      aria-label="Filter by rep"
      value={current ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        const v = e.target.value;
        if (v) next.set("rep", v);
        else next.delete("rep");
        router.push(`?${next.toString()}`);
      }}
      // No text-sm: the base class is text-[16px] md:text-sm, and passing
      // text-sm here makes tailwind-merge drop the 16px step that keeps mobile
      // Safari from zooming the viewport on focus. max-w keeps a long rep name
      // from widening this w-auto select past the row on a phone.
      className="h-12 w-auto min-w-20 max-w-40 md:h-[30px] md:max-w-none"
    >
      <option value="">All</option>
      <option value={profileId}>My</option>
      {reps
        .filter((r) => r.id !== profileId)
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
    </NativeSelect>
  );
}
