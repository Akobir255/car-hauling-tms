"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { FieldLabel } from "@/components/form-section";

// One dispatch-terms select; options are msgplane's verbatim vocabulary
// (src/lib/dispatch-terms.ts). Used by the edit form and the Dispatch Sheet.
export function TermsSelect({
  name,
  label,
  options,
  value,
  fallback,
}: {
  name: string;
  label: string;
  options: readonly string[];
  value: string | null;
  fallback?: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <NativeSelect id={name} name={name} defaultValue={value ?? fallback ?? ""}>
        {!fallback && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
