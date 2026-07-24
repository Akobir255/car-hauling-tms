// Vehicle make/model suggestions.
//
// Makes come from a curated list of real consumer brands — NOT NHTSA's
// GetAllMakes, whose 10,000+ rows are full of registered manufacturers nobody
// ships ("toy" there matches junk before Toyota). Models still come from
// NHTSA's free vPIC API, which is clean once the make is a real brand.

const MAKES = [
  "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Buick",
  "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ferrari", "Fiat", "Ford",
  "Genesis", "GMC", "Honda", "Hummer", "Hyundai", "Infiniti", "Jaguar",
  "Jeep", "Kia", "Lamborghini", "Land Rover", "Lexus", "Lincoln", "Lotus",
  "Lucid", "Maserati", "Mazda", "McLaren", "Mercedes-Benz", "Mercury",
  "Mini", "Mitsubishi", "Nissan", "Oldsmobile", "Plymouth", "Polestar",
  "Pontiac", "Porsche", "Ram", "Rivian", "Rolls-Royce", "Saab", "Saturn",
  "Scion", "Smart", "Subaru", "Suzuki", "Tesla", "Toyota", "Volkswagen",
  "Volvo",
];

export async function searchMakes(query: string): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const prefix = MAKES.filter((m) => m.toLowerCase().startsWith(q));
  if (prefix.length > 0) return prefix.slice(0, 8);
  // Fall back to substring so "benz" still finds Mercedes-Benz.
  return MAKES.filter((m) => m.toLowerCase().includes(q)).slice(0, 8);
}

const BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const modelsCache = new Map<string, string[]>();

export async function searchModels(make: string, query: string): Promise<string[]> {
  const brand = make.trim();
  if (!brand) return [];
  const key = brand.toLowerCase();
  let models = modelsCache.get(key);
  if (!models) {
    try {
      const r = await fetch(`${BASE}/GetModelsForMake/${encodeURIComponent(brand)}?format=json`);
      const d = await r.json();
      models = [
        ...new Set<string>(
          (d.Results ?? [])
            .map((m: { Model_Name?: string }) => m.Model_Name ?? "")
            .filter(Boolean)
        ),
      ];
      modelsCache.set(key, models);
    } catch {
      return [];
    }
  }
  const q = query.trim().toLowerCase();
  const filtered = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  return filtered.slice(0, 10);
}
