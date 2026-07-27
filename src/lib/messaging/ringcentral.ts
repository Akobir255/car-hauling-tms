// RingCentral SMS sender — server-only. Uses the JWT credential flow
// (server-to-server, no browser login). Activates automatically once the
// four RINGCENTRAL_* env vars are set; until then isConfigured() is false
// and bulk sends stay logged as `queued` for a later retry.

import {
  SmsProviderOutageError,
  SmsRateLimitError,
  SmsSuppressedError,
} from "@/lib/messaging/sms-bulk";
import { isSuppressed } from "@/lib/messaging/suppression";

function parseRetryAfterMs(res: Response): number | null {
  const seconds = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

const RC_SERVER = (process.env.RINGCENTRAL_SERVER_URL || "https://platform.ringcentral.com").trim();
const RC_CLIENT_ID = (process.env.RINGCENTRAL_CLIENT_ID || "").trim();
const RC_CLIENT_SECRET = (process.env.RINGCENTRAL_CLIENT_SECRET || "").trim();
const RC_JWT = (process.env.RINGCENTRAL_JWT || "").trim();
const RC_FROM_NUMBER = (process.env.RINGCENTRAL_FROM_NUMBER || "").trim();

export function isSmsConfigured(): boolean {
  return Boolean(RC_CLIENT_ID && RC_CLIENT_SECRET && RC_JWT && RC_FROM_NUMBER);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  // Auth failing is a PROVIDER problem, never a recipient problem: typed so
  // the bulk engine stops the chunk instead of logging every remaining
  // recipient as permanently "failed" (and instead of re-hitting the token
  // endpoint per recipient — RingCentral's Auth group allows only 5/min).
  let res: Response;
  try {
    res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: RC_JWT,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new SmsProviderOutageError(
      `RingCentral auth unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (res.status === 429) {
    await res.text().catch(() => {});
    throw new SmsRateLimitError(parseRetryAfterMs(res));
  }
  if (!res.ok) {
    throw new SmsProviderOutageError(`RingCentral auth failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export async function sendSms(to: string, text: string): Promise<{ providerMessageId: string }> {
  if (!isSmsConfigured()) {
    throw new Error("RingCentral is not configured");
  }
  // Last line of defense, before the token is even fetched. Every outbound
  // text in the app funnels through here, so a number on the do-not-text list
  // cannot be reached by any call site, present or future — including one that
  // forgets to check, or one texting a number with no customer row at all.
  if (await isSuppressed(to)) {
    throw new SmsSuppressedError(to);
  }
  const token = await getAccessToken();
  // Network failure or a hung socket is a provider problem (typed so bulk
  // chunks stop cleanly); a non-ok response other than 429 is a problem with
  // THIS message only. The timeout keeps one stalled request from eating the
  // chunk budget — without it, already-sent texts could die unlogged when
  // Vercel kills the invocation.
  let res: Response;
  try {
    res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { phoneNumber: RC_FROM_NUMBER },
        to: [{ phoneNumber: to }],
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err instanceof SmsProviderOutageError) throw err;
    throw new SmsProviderOutageError(
      `RingCentral unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (res.status === 429) {
    // Retry-After is seconds; the bulk engine paces around it. Body drained
    // so the connection can be reused.
    await res.text().catch(() => {});
    throw new SmsRateLimitError(parseRetryAfterMs(res));
  }
  if (!res.ok) {
    throw new Error(`RingCentral send failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { providerMessageId: String(data.id ?? "") };
}

// Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null if not a
// plausible 10-digit US number.
export function toE164(value: string | null | undefined): string | null {
  let d = (value || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return `+1${d}`;
}

// ---- Inbound webhook subscription management ----
// RingCentral pushes new-SMS notifications to our webhook once a subscription
// exists. The verification token below is echoed back by RingCentral on every
// notification so the webhook can prove the request really came from them.

export const INBOUND_SMS_EVENT_FILTER =
  "/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS";

export function getWebhookVerificationToken(): string {
  return (process.env.RINGCENTRAL_WEBHOOK_TOKEN || "").trim();
}

export type RcSubscription = {
  id: string;
  status: string;
  eventFilters: string[];
  expirationTime?: string;
  deliveryMode: { transportType: string; address?: string };
};

export async function listSubscriptions(): Promise<RcSubscription[]> {
  const token = await getAccessToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/subscription`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`RingCentral list subscriptions failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return (data.records ?? []) as RcSubscription[];
}

export async function createInboundSubscription(address: string): Promise<RcSubscription> {
  const verificationToken = getWebhookVerificationToken();
  if (!verificationToken) {
    throw new Error("RINGCENTRAL_WEBHOOK_TOKEN is not set");
  }
  const token = await getAccessToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/subscription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventFilters: [INBOUND_SMS_EVENT_FILTER],
      deliveryMode: {
        transportType: "WebHook",
        address,
        verificationToken,
      },
      expiresIn: 630720000, // max — effectively permanent; the Connect button re-checks anyway
    }),
  });
  if (!res.ok) {
    throw new Error(`RingCentral create subscription failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as RcSubscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/subscription/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`RingCentral delete subscription failed (${res.status}): ${await res.text()}`);
  }
}
