// Paced bulk-SMS engine — pure logic, no env, no provider imports, so the
// pacing/retry behavior is unit-testable with fake senders and clocks.
//
// Why pacing exists: RingCentral's SMS endpoint is in the "Medium" rate-limit
// group — 40 requests per extension per minute. An unpaced loop gets 429s on
// everything past the cutoff. Official guidance is ~1 send per 1.5s, honoring
// Retry-After on 429 (30s when the header is missing).
// https://developers.ringcentral.com/guide/basics/rate-limits

// Recipients per server-action call. Small enough that one call finishes in
// ~20s; the client chains calls and shows progress between them.
export const SMS_CHUNK_MAX = 10;

// Whole-blast cap, enforced where the blast is still whole (the compose UI).
// Matches the email cap, and stays under the ~200-unique-recipients-per-day
// carrier norm for local 10DLC numbers — beyond that, carriers filter
// silently rather than erroring.
export const SMS_BLAST_MAX = 100;

// Slightly above the 1.5s guidance so chunk-boundary latency can never push
// the average over 40/min. Applied before EVERY send.
export const SMS_SEND_INTERVAL_MS = 1700;

// 429 handling: wait what RingCentral asks (capped so one message can't eat
// the whole invocation), or 30s when Retry-After is absent — the documented
// fallback. One retry per message; a second 429 stops the chunk and returns
// the remainder to the caller to resume later.
export const SMS_RETRY_FALLBACK_MS = 30_000;
export const SMS_RETRY_CAP_MS = 45_000;

// Hard wall-clock budget for one chunk invocation. Far under Vercel's 300s
// fluid-compute ceiling, so a chunk always returns cleanly instead of being
// killed mid-send with nothing logged.
export const SMS_CHUNK_BUDGET_MS = 90_000;

// Thrown by the RingCentral sender on HTTP 429 so this engine can tell
// "slow down" apart from a genuinely failed message.
export class SmsRateLimitError extends Error {
  constructor(public retryAfterMs: number | null) {
    super("Rate limited by RingCentral");
    this.name = "SmsRateLimitError";
  }
}

export type SmsOutcome = {
  status: "sent" | "queued" | "failed";
  providerMessageId: string | null;
};

export type SmsChunkRun = {
  // One entry per ATTEMPTED recipient, in input order. Shorter than the
  // input when a rate-limit stop left a tail unattempted.
  outcomes: SmsOutcome[];
  // How long the caller should wait before resuming the unattempted tail.
  // Null when everything was attempted.
  retryAfterMs: number | null;
};

export type SmsChunkDeps = {
  // False = provider not configured; everything logs as "queued" instantly.
  ready: boolean;
  send: (to: string, text: string) => Promise<{ providerMessageId: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

function cappedRetryWait(err: SmsRateLimitError): number {
  const asked = err.retryAfterMs ?? SMS_RETRY_FALLBACK_MS;
  return Math.min(Math.max(asked, 1000), SMS_RETRY_CAP_MS);
}

export async function runSmsChunk(
  recipients: readonly { to: string; text: string }[],
  deps: SmsChunkDeps
): Promise<SmsChunkRun> {
  const outcomes: SmsOutcome[] = [];

  if (!deps.ready) {
    for (const _ of recipients) outcomes.push({ status: "queued", providerMessageId: null });
    return { outcomes, retryAfterMs: null };
  }

  const startedAt = deps.now();
  const withinBudget = (extraMs: number) =>
    deps.now() - startedAt + extraMs < SMS_CHUNK_BUDGET_MS;

  for (const r of recipients) {
    if (!withinBudget(SMS_SEND_INTERVAL_MS)) {
      return { outcomes, retryAfterMs: 1000 };
    }
    await deps.sleep(SMS_SEND_INTERVAL_MS);

    let retried = false;
    for (;;) {
      try {
        const result = await deps.send(r.to, r.text);
        outcomes.push({ status: "sent", providerMessageId: result.providerMessageId });
        break;
      } catch (err) {
        if (err instanceof SmsRateLimitError) {
          const wait = cappedRetryWait(err);
          if (retried || !withinBudget(wait)) {
            // Persistent rate limiting — stop here; the unattempted tail
            // (including this recipient) goes back to the caller untouched.
            return { outcomes, retryAfterMs: wait };
          }
          retried = true;
          await deps.sleep(wait);
          continue;
        }
        // A real send failure for THIS number (bad number, blocked, etc.) —
        // record it and keep going; one dud must not sink the blast.
        console.error(`SMS to ${r.to} failed:`, err);
        outcomes.push({ status: "failed", providerMessageId: null });
        break;
      }
    }
  }

  return { outcomes, retryAfterMs: null };
}

// Split ids into chunk-action-sized groups. Lives here (not in the client)
// so the cap and the splitter can't drift apart.
export function chunkIds(ids: readonly string[], size: number = SMS_CHUNK_MAX): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
