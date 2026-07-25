// CTIA opt-out/opt-in keyword detection. Honoring STOP is a legal
// requirement, not a feature, so this lives in its own module: the webhook
// imports it and tests/format.test.ts covers it.
//
// The message must be JUST the keyword (trailing punctuation allowed) —
// "please stop by the shop" is not an opt-out.

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "CONTINUE"]);

export function optKeyword(text: string): "stop" | "start" | null {
  const word = (text ?? "").trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  return null;
}
