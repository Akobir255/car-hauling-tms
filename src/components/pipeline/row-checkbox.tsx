"use client";

import { useSelection } from "./selection-context";

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={label}
      className="mt-1 size-4 cursor-pointer accent-primary"
    />
  );
}

export function SelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setMany } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      onChange={() => setMany(ids, !allSelected)}
      aria-label="Select all rows"
      className="size-4 cursor-pointer accent-primary"
    />
  );
}
