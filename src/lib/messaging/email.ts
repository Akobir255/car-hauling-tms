// Transactional email via Resend — server-only, no SDK (plain fetch, same
// shape as the RingCentral sender). Activates once RESEND_API_KEY and
// EMAIL_FROM are set; until then isEmailConfigured() is false and bulk email
// stays logged as `queued` so nothing is lost.

const API_URL = "https://api.resend.com/emails";
const API_KEY = (process.env.RESEND_API_KEY || "").trim();
// Must be an address on a domain verified in Resend, e.g.
// "US Star Trucking <dispatch@usstrucking.org>".
const FROM = (process.env.EMAIL_FROM || "").trim();
const REPLY_TO = (process.env.EMAIL_REPLY_TO || "").trim();

export function isEmailConfigured(): boolean {
  return Boolean(API_KEY && FROM);
}

export function emailFromAddress(): string {
  return FROM;
}

// Plain text -> minimal HTML: escape, keep paragraph breaks, linkify URLs so
// a texted-style contract link is clickable in an email client.
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb">$1</a>'
  );
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${paragraphs}</div>`;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<{ providerMessageId: string }> {
  if (!isEmailConfigured()) throw new Error("Email is not configured");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      text,
      html: textToHtml(text),
      ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { providerMessageId: String(data?.id ?? "") };
}

// Basic shape check — the real validation is the provider's bounce handling.
export function isPlausibleEmail(value: string | null | undefined): boolean {
  const v = (value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}
