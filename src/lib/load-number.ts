// Generates load numbers in the same `########-US` shape used by the
// marketing site's order numbers, for a consistent convention across
// systems. Uniqueness is enforced by the DB's `unique` constraint on
// loads.load_number — callers should retry on a conflict.
export function generateLoadNumber(): string {
  const digits = Math.floor(10_000_000 + Math.random() * 90_000_000);
  return `${digits}-US`;
}
