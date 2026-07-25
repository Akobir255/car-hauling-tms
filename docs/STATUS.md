# Project state — read this before changing anything

US Star Trucking's broker TMS. Replaces a paid SuiteCRM-based system (msgplane,
$250/mo + $50/user). Live at **https://carshiphelp.com** for a team of ~48.

Last updated: 2026-07-25.

## Stack

- Next.js 16 (App Router, TS, Turbopack). Middleware lives in `src/proxy.ts`.
- Supabase (project `fqcqxlpprwuilnbsztzm`, us-east-1). RLS everywhere.
- Tailwind v4 + shadcn on Base UI. **Button takes a `render` prop, not `asChild`.**
- Vercel. Domain on Cloudflare (grey-cloud/DNS-only for the app records).

## Commands

```
npm run dev        npm run lint      npx tsc --noEmit
npm test           # 40 unit tests, no network
npm run test:rls   # 11 integration tests against the REAL database
node scripts/email-setup.mjs [address]   # check email config / send a test
```

Migrations are applied with the Supabase CLI (`npx supabase db push`), NOT by
pasting SQL. The CLI is linked and authenticated; it provisions a temporary
login role, so no database password is needed.

## The five things that will bite you

1. **Margin protection is enforced in Postgres, not in app code.** Migration
   0013 revokes SELECT/INSERT/UPDATE on `carrier_pay`, `carrier_received`,
   `cod_to_carrier` (plus INSERT/UPDATE on `carrier_id`, `dispatcher_id`) from
   the `authenticated` role. Consequences:
   - Managers must read loads through the **`loads_full`** view — a base-table
     `select("*")` returns 42501. Use the `MANAGER_LOADS_TABLE` constant in
     `src/lib/loads-table.ts`; never hardcode `"loads"` for a manager read.
   - Sales read through **`loads_sales_safe`**.
   - Writing a margin column requires `createAdminClient()` *after* an explicit
     `requireRole` check (see `updateLoad`, `duplicateLoad`, `createLoad`).
   - Adding a loads column? Grant it explicitly and add it to both views.
   - `npm run test:rls` is the regression alarm for all of this.

2. **Postgres applies SELECT policies to UPDATE ... WHERE.** An earlier version
   of 0013 removed sales' SELECT policy on `loads`; every sales write then
   silently matched 0 rows *while the app still wrote "success" history rows*.
   If a write mysteriously no-ops, check row visibility first.

3. **CSP carries a per-request nonce**, built in `src/lib/security-headers.ts`
   and applied in `src/proxy.ts`. Only three origins are reachable from the
   browser: Supabase, `tile.openstreetmap.org` (Leaflet), and
   `vpic.nhtsa.dot.gov` (make/model autocomplete — it's imported by a client
   component). Anything new the browser must call has to be added to
   `connect-src`. `/api/telephony/*` is exempt (carriers aren't browsers).

4. **Bulk sends must not loop unpaced per recipient.** Email uses Resend's
   batch endpoint (100 per call) plus one bulk insert. SMS has no batch
   endpoint and RingCentral allows only **40 sends/minute** (429 + Retry-After
   beyond that), so SMS blasts are CHUNKED: the client (compose page and the
   pipeline bulk bar) calls a chunk action per `SMS_CHUNK_MAX` recipients, and
   `runSmsChunk` in `src/lib/messaging/sms-bulk.ts` paces sends 1.7s apart,
   retries once per message on 429, and hands any rate-limited/outage tail
   back for the client to resume. Rows are logged once per chunk. Any NEW
   SMS-sending path must go through `runSmsChunk` — never call `sendSms` in a
   loop. Carrier norms still apply on top: local 10DLC numbers max out around
   ~200 unique recipients / ~1,000 texts per day, silently filtered beyond
   that. (RingCentral's High Volume SMS API would lift this but requires
   support-provisioned A2P permission and makes the number app-SMS-only.)

5. **Lint rules `react-hooks/set-state-in-effect` and `react-hooks/refs` are
   errors and fail the build.** Defer setState into timers/callbacks; update
   refs in effects, never during render.

## What's live

Leads → Quotes → Orders pipeline with msgplane-style tabs · Follow-up Today
queue · bulk select + reassign/SMS/follow-up · two-way SMS (RingCentral,
inbound webhook + STOP handling) · e-sign (real US Star contract text in
`src/lib/esign-terms.ts`, typed-name signature, 14-day link expiry, token
rotation on void, per-open IP audit) · tickets with comment threads · email
blasts (Resend) · smart intake (ZIP→city autofill, suggested pricing, NHTSA
make/model) · security headers · vehicle photos (`/api/vehicles/image`
resolves make/model to a Wikipedia page image server-side and streams it from
our origin — no CSP changes; misses fall back to the type silhouette in
`vehicle-thumb.tsx`) · per-order message timeline (order detail shows the
customer's last 30 SMS/emails, msgplane-style; rows tied to that order get a
"this order" chip; RLS-scoped like everything else) · strict pipeline state
machine (lead→quote happens by PRICING, quote→order by convert, dispatch
requires a posted order AND an assigned carrier, picked-up→delivered can't
skip stages; dispatch/picked-up/delivered/un-dispatch are dispatch-desk
actions hidden from sales AND enforced server-side in `transition()` —
they mirror what the carrier reports until the CD/SD APIs land).

## Integrations

| | |
|---|---|
| SMS | RingCentral, from +1 865 722 7114. Inbound webhook at `/api/webhooks/ringcentral`, gated by `RINGCENTRAL_WEBHOOK_TOKEN`. |
| Email | Resend, verified sending domain **mail.carshiphelp.com**. Key is send-only, so it 401s on `/domains` — that's correct, not a bug. |
| Geo | OpenRouteService (`ORS_KEY`) for ZIP→city and lane mileage, server-side only. |

**Never send from `usstrucking.org`.** That's the company's live Google
Workspace domain; sending bulk from it would put real business email at risk.
(Its root SPF also has a typo — `include:_spf.google.com~all` is missing the
space before `~all`, making the include unresolvable. Registrar is Squarespace.)

## Open items

- Supabase dashboard: password policy (min length 12, complexity, secure
  password change) — no API for it.
- DMARC record for the sending domain.
- Base UI logs "expected a native `<button>`" on the dashboard and new-load
  form — a `render` prop misuse, accessibility only.
- CI exists (.github/workflows/ci.yml): typecheck + lint + unit tests + build
  on every push/PR. The RLS job SKIPS until the three Supabase secrets are
  added to the repo (Settings → Secrets → Actions): NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
- The GitHub repo is PUBLIC. Decide if that's intended before adding secrets
  or treating the contract text / schema as private.
- SMS blast caps are per-send and client-enforced (100/blast); nothing tracks
  cumulative daily volume against the ~200-recipient carrier norm, and two
  operators blasting simultaneously share the 40/min limit (the 429 handling
  absorbs it, but sends slow down).
