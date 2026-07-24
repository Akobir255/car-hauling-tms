// Vehicle make/model suggestions from the free NHTSA vPIC API (no key), the
// same source the marketing site uses. All makes are fetched once and cached
// in the module for prefix filtering; models are fetched per make.

const BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

let makesCache: string[] | null = null;

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

export async function searchMakes(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  if (!makesCache) {
    try {
      const r = await fetch(`${BASE}/GetAllMakes?format=json`);
      const d = await r.json();
      makesCache = (d.Results ?? [])
        .map((m: { Make_Name?: string }) => (m.Make_Name ? titleCase(m.Make_Name) : ""))
        .filter(Boolean);
    } catch {
      makesCache = [];
    }
  }
  return (makesCache ?? []).filter((m) => m.toLowerCase().startsWith(q)).slice(0, 8);
}

export async function searchModels(make: string, query: string): Promise<string[]> {
  if (!make.trim()) return [];
  try {
    const r = await fetch(`${BASE}/GetModelsForMake/${encodeURIComponent(make)}?format=json`);
    const d = await r.json();
    let models: string[] = (d.Results ?? [])
      .map((m: { Model_Name?: string }) => m.Model_Name ?? "")
      .filter(Boolean);
    const q = query.trim().toLowerCase();
    if (q) models = models.filter((m) => m.toLowerCase().includes(q));
    return [...new Set(models)].slice(0, 10);
  } catch {
    return [];
  }
}
