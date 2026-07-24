// RingCentral SMS sender — server-only. Uses the JWT credential flow
// (server-to-server, no browser login). Activates automatically once the
// four RINGCENTRAL_* env vars are set; until then isConfigured() is false
// and bulk sends stay logged as `queued` for a later retry.

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
  const res = await fetch(`${RC_SERVER}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: RC_JWT,
    }),
  });
  if (!res.ok) {
    throw new Error(`RingCentral auth failed (${res.status}): ${await res.text()}`);
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
  const token = await getAccessToken();
  const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension/~/sms`, {
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
  });
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
