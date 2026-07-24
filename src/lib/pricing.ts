// Suggested-quote pricing, ported from the marketing site's calculateQuote.
// Mileage-tier base rate + adjustments for vehicle type / condition / transport.
// This is only a SUGGESTION shown to the agent — never auto-filled into the rate.

export type QuoteInput = {
  miles: number;
  vehicleType: string; // TMS enum: sedan | suv | pickup | van | motorcycle | other
  condition: string; // running | non_running
  transport: string; // open | enclosed | driveaway
};

export function calculateQuote({ miles, vehicleType, condition, transport }: QuoteInput): number {
  let rate: number;
  if (miles <= 300) rate = 1.3;
  else if (miles <= 700) rate = 1.1;
  else if (miles <= 1200) rate = 0.85;
  else if (miles <= 2400) rate = 0.7;
  else rate = 0.6;

  let price = miles * rate;
  if (price < 200) price = 200;

  const type = vehicleType.toLowerCase();
  if (type === "suv") price += 100;
  else if (type === "pickup") price += 150;
  else if (type === "van") price += 100;

  if (condition === "non_running") price += 100;
  if (transport === "enclosed") price *= 1.3;

  return Math.round(price);
}
