import { describe, expect, it } from "vitest";
import {
  SMS_CHUNK_BUDGET_MS,
  SMS_CHUNK_MAX,
  SMS_RETRY_CAP_MS,
  SMS_RETRY_FALLBACK_MS,
  SMS_SEND_INTERVAL_MS,
  SmsProviderOutageError,
  SmsRateLimitError,
  SmsSuppressedError,
  chunkIds,
  runSmsChunk,
  type SmsChunkDeps,
} from "@/lib/messaging/sms-bulk";

// Fake clock + sender: sleep() advances virtual time instantly, send() replies
// per a script. Lets the pacing/retry/budget logic run in microseconds.
function harness(script: (to: string, attempt: number) => "ok" | Error) {
  let time = 0;
  const sleeps: number[] = [];
  const sendLog: string[] = [];
  const attempts = new Map<string, number>();
  const deps: SmsChunkDeps = {
    ready: true,
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
    now: () => time,
    send: (to) => {
      const attempt = (attempts.get(to) ?? 0) + 1;
      attempts.set(to, attempt);
      sendLog.push(to);
      const result = script(to, attempt);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({ providerMessageId: `id-${to}-${attempt}` });
    },
  };
  return { deps, sleeps, sendLog };
}

const recipients = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ to: `+1615555000${i}`, text: `msg ${i}` }));

describe("runSmsChunk pacing", () => {
  it("waits the pacing interval before every send so 40/min is never exceeded", async () => {
    const { deps, sleeps, sendLog } = harness(() => "ok");
    const run = await runSmsChunk(recipients(3), deps);

    expect(sendLog).toHaveLength(3);
    expect(sleeps).toEqual([SMS_SEND_INTERVAL_MS, SMS_SEND_INTERVAL_MS, SMS_SEND_INTERVAL_MS]);
    expect(run.outcomes.map((o) => o.status)).toEqual(["sent", "sent", "sent"]);
    expect(run.retryAfterMs).toBeNull();
  });

  it("returns provider ids in recipient order", async () => {
    const { deps } = harness(() => "ok");
    const run = await runSmsChunk(recipients(2), deps);
    expect(run.outcomes.map((o) => o.providerMessageId)).toEqual([
      "id-+16155550000-1",
      "id-+16155550001-1",
    ]);
  });

  it("marks everything queued without touching the network when unconfigured", async () => {
    const { deps, sleeps, sendLog } = harness(() => "ok");
    deps.ready = false;
    const run = await runSmsChunk(recipients(4), deps);

    expect(sendLog).toHaveLength(0);
    expect(sleeps).toHaveLength(0);
    expect(run.outcomes.map((o) => o.status)).toEqual(["queued", "queued", "queued", "queued"]);
  });
});

describe("runSmsChunk failure handling", () => {
  it("records a plain send failure and keeps going — one dud can't sink the blast", async () => {
    const { deps } = harness((to) =>
      to.endsWith("1") ? new Error("invalid number") : "ok"
    );
    const run = await runSmsChunk(recipients(3), deps);
    expect(run.outcomes.map((o) => o.status)).toEqual(["sent", "failed", "sent"]);
    expect(run.retryAfterMs).toBeNull();
  });

  it("refuses an opted-out recipient without retrying and keeps the blast going", async () => {
    const { deps, sendLog } = harness((to) =>
      to.endsWith("1") ? new SmsSuppressedError(to) : "ok"
    );
    const run = await runSmsChunk(recipients(3), deps);

    expect(run.outcomes.map((o) => o.status)).toEqual(["sent", "failed", "sent"]);
    // Attempted exactly once: a STOP is not a transient error to retry around.
    expect(sendLog.filter((to) => to.endsWith("1"))).toHaveLength(1);
    expect(run.providerError).toBeNull();
  });

  it("honors Retry-After on a 429 and retries that message once", async () => {
    const { deps, sleeps } = harness((to, attempt) =>
      to.endsWith("1") && attempt === 1 ? new SmsRateLimitError(5000) : "ok"
    );
    const run = await runSmsChunk(recipients(3), deps);

    expect(run.outcomes.map((o) => o.status)).toEqual(["sent", "sent", "sent"]);
    expect(sleeps).toContain(5000);
    // The retried message's id shows it succeeded on attempt 2.
    expect(run.outcomes[1].providerMessageId).toBe("id-+16155550001-2");
  });

  it("falls back to the documented 30s wait when 429 has no Retry-After", async () => {
    const { deps, sleeps } = harness((to, attempt) =>
      attempt === 1 && to.endsWith("0") ? new SmsRateLimitError(null) : "ok"
    );
    await runSmsChunk(recipients(1), deps);
    expect(sleeps).toContain(SMS_RETRY_FALLBACK_MS);
  });

  it("caps an absurd Retry-After so one message can't eat the invocation", async () => {
    const { deps, sleeps } = harness((to, attempt) =>
      attempt === 1 ? new SmsRateLimitError(600_000) : "ok"
    );
    await runSmsChunk(recipients(1), deps);
    expect(sleeps).toContain(SMS_RETRY_CAP_MS);
    expect(sleeps).not.toContain(600_000);
  });

  it("stops on a provider outage instead of failing every remaining recipient", async () => {
    // An auth-endpoint failure used to grind all 100 recipients into
    // permanent "failed" rows for a transient hiccup — it must stop the
    // chunk instead, leaving the tail unattempted and resumable.
    const { deps } = harness((to) =>
      to.endsWith("1") ? new SmsProviderOutageError("auth down") : "ok"
    );
    const run = await runSmsChunk(recipients(4), deps);

    expect(run.outcomes.map((o) => o.status)).toEqual(["sent"]);
    expect(run.providerError).toBe("auth down");
    expect(run.retryAfterMs).toBeNull();
  });

  it("stops on persistent rate limiting and returns the unattempted tail", async () => {
    const { deps } = harness((to) =>
      to.endsWith("1") ? new SmsRateLimitError(2000) : "ok"
    );
    const run = await runSmsChunk(recipients(4), deps);

    // Recipient 0 sent; recipient 1 got 429 twice -> stop. 1, 2, 3 unattempted.
    expect(run.outcomes.map((o) => o.status)).toEqual(["sent"]);
    expect(run.retryAfterMs).toBe(2000);
  });

  it("stops before blowing the invocation budget and asks the caller to resume", async () => {
    const { deps } = harness(() => "ok");
    const perSend = SMS_SEND_INTERVAL_MS;
    const fitsInBudget = Math.floor((SMS_CHUNK_BUDGET_MS - 1) / perSend);
    // Sanity: the real chunk cap always fits the budget with room to spare.
    expect(SMS_CHUNK_MAX * perSend).toBeLessThan(SMS_CHUNK_BUDGET_MS / 2);
    // Force the budget path with a huge synthetic chunk.
    const big = Array.from({ length: fitsInBudget + 5 }, (_, i) => ({
      to: `+1615${String(i).padStart(7, "0")}`,
      text: "x",
    }));
    const run = await runSmsChunk(big, deps);
    expect(run.outcomes.length).toBe(fitsInBudget);
    expect(run.retryAfterMs).not.toBeNull();
  });
});

describe("chunkIds", () => {
  it("splits ids into chunk-action-sized groups, last group short", () => {
    const ids = Array.from({ length: 23 }, (_, i) => `c${i}`);
    const chunks = chunkIds(ids, 10);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns no chunks for no ids", () => {
    expect(chunkIds([])).toEqual([]);
  });
});
