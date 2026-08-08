# Receiving leads from lead generators

Two inbound doors, both dark until a provider is pointed at them. Nothing runs
on its own — a door only carries traffic once a `lead_sources` row exists and a
provider is configured to send to it.

## The two doors

| | JSON | Email |
|---|---|---|
| URL | `POST /api/webhooks/leads/<source>` | `POST /api/webhooks/email/<source>` |
| For | providers that POST structured JSON | providers that only email leads |
| Auth | `X-Lead-Token: <token>` header (or `Authorization: Bearer`) | same |
| Parsing | field aliases (`src/lib/leads/normalize.ts`) | the intake model reads the email body |
| Needs `ANTHROPIC_API_KEY` | no | **yes** — off until set |

Both converge on `createLeadFromNormalized()`: a load at status `lead`, in a
rep's queue (`next_lead_owner`, round-robin), customer matched on phone/email,
vehicle attached, and a `lead_intake` attribution row. Duplicates are caught —
by the provider's own id (JSON) or the email Message-Id.

## Turning a provider on

```bash
node scripts/add-lead-source.mjs <key> "<Display Name>"
```

Prints the URL and a one-time token. Store nothing — the token is only kept as
a SHA-256 hash. Give the provider the URL, the token (in `X-Lead-Token`), and
POST/JSON. Other commands:

```bash
node scripts/add-lead-source.mjs --list
node scripts/add-lead-source.mjs <key> --deactivate   # its posts start 404-ing
```

## Why the email door needs the model

A JSON lead carries labelled fields. An email is prose, and the customer's
phone and email live *inside* the prose — the envelope `From` is usually the
provider's own system address. So an email lead depends on the intake model to
find the contact. Until `ANTHROPIC_API_KEY` is set, an inbound email is
**accepted and kept raw** in `webhook_events` (outcome `received_pending_ai`)
but no half-blank lead is invented. It waits, recoverable, for the key.

## Where it all lands / how to watch it

- Leads appear on the **Leads** pipeline like any other new inquiry.
- Every delivery — stored, duplicate, rejected, unauthorized — is logged to
  `webhook_events` with `source = 'lead:<key>'` and the raw body, so a lead is
  never silently lost and a broken mapping is fixable from the record.
- `lead_source_performance` (admin) shows leads, close rate and signed revenue
  per provider — which is how you decide who is worth paying. Meaningful only
  after real leads have had time to close.

## The security shape (why it is safe to expose)

`/api/webhooks/*` bypasses the session middleware, so each handler is the whole
boundary and runs as the service role. The guards live once in
`src/lib/leads/webhook-shared.ts`, shared by both routes: constant-time token
check against the stored hash, fail-closed on an unknown/inactive source (404 ==
401 so keys can't be enumerated), a body cap, and a per-IP rate limit. The
handlers only ever write a customer, a `lead` load, its vehicle and the
attribution row — never a margin column.
