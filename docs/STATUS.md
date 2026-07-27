# Project state — read this before changing anything

US Star Trucking's broker TMS. Replaces a paid SuiteCRM-based system (msgplane,
$250/mo + $50/user). Live at **https://carshiphelp.com** for a team of ~48.

Last updated: 2026-07-26.

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
machine (lead→quote happens by PRICING — automatic, including on edit;
quote→order by convert only when priced; **dispatch is not a button for
anyone, admin included** — assigning a carrier to a POSTED order is what
sets Dispatched, in `updateLoad`; picked-up/delivered/cancelled-after-
dispatch mirror what the CARRIER reports and will be driven by the CD/SD
integration — until then orders rest at Dispatched, which is the intended
msgplane behavior; un-dispatch = "Unpost" on a dispatched order, dispatch
desk only, and it releases the carrier so re-assignment re-dispatches) ·
pipeline-list msgplane parity (per-row unread-message badges — red when >0,
notes counter, floating "+" quick-create) · follow-up quick-note buttons
("Left message" / "Spoke to someone") on the edit page's follow-up section.
· the msgplane SMS template library (all 34 canned texts imported into
message_templates via scripts/seed-msgplane-templates.mjs — idempotent;
they use the new {{agent}} and {{vehicle}} variables, which render from
the sending rep's name and the latest load's first vehicle) · the
msgplane EMAIL template library (20 templates via
scripts/seed-msgplane-email-templates.mjs — quote variants, follow-ups,
order confirmation, dispatched/delivered notices, invoice, receipt,
thank-you, referral; captured from the email composer's TinyMCE editor,
kept as US Star's words but rewritten for our plain-text→HTML renderer so
nothing links back to msgplane-hosted pages)
· contract auto-send (converting a quote to an order automatically EMAILS
the customer their signing link — msgplane's generate_and_send; failure is
advisory, logged to history + the order's message timeline, never blocks
the conversion; the E-Sign panel's manual Send now emails by default, SMS
via the existing button).
· Load Requests band (0019 `load_requests`): the blue add-form strip at the
top of every ORDER record — price / carrier (directory autocomplete via
/api/carriers/suggest, free text allowed) / CD|SD tag / dates; per-row
Dispatch (managers, posted orders — creates a directory record for free-text
carriers first) and the header DISPATCH button (opens carrier assignment —
still never a bare status flip; sales never see it; pipeline.test.ts pins
this) · contract VERSIONS (0019 `contract_versions`): every send is a
version with its own token; E-Sign band is msgplane's — open / resend /
sms / view all / change terms & send (red) — where "change terms & send"
updates tariff/deposit + card requirement and mints a new version (old link
dies, signature voided), "view all" lists versions with make-current
(manager, unsigned only) and the per-open IP audit with check-location
links · with/without-card contracts: "send + card info" (or the checkbox in
change-terms) makes the public signing page ask for card details;
**the full card number and CVV never reach the server** — those inputs have
no name attribute, the browser submits only brand/last4/expiry/billing,
stored in `contract_cards` (service-role writes only; staff read shows a
"VISA •••• 1234" chip on the E-Sign band). Real vaulting arrives with the
Stax-or-Stripe decision · public /sign page restyled as the msgplane Order
Invoice sheet (letterhead + M.C.# from COMPANY in esign-terms.ts,
shipper/shipping info, origin/destination, vehicle table with photo —
/api/vehicles/image is now a PUBLIC path for this — totals incl. computed
COD-to-carrier = tariff − deposit, A–H terms, sticky GET STARTED bar) with
a draw-signature pad (PNG stored on the version; typed name remains the
signature of record) and the card form when required · order footer has
msgplane's orange NEXT (next record in the same stage, newest-first) ·
quick notes on list rows are now an anchored popover at the row (textarea +
SAVE/CANCEL, msgplane-style), not a bottom sheet.
· From the 2026-07-26 msgplane EDIT-PAGE tour (migration 0020): dispatch
terms live in `src/lib/dispatch-terms.ts` — msgplane's VERBATIM select
options for Balance Paid By / COD-COP Method / Payment Terms / Terms Begin /
Payment Method / Invoice Payment Method (columns free-text on loads; app
supplies the vocabulary). The edit form gained the Dispatch & payment terms
section, driver first/last/phone, Central Dispatch note (60-char cap
enforced server-side), Information-for-shipper, buyer numbers on both
addresses, and msgplane's "Request credit card information" checkbox (a
marker input protects the flag from partial forms). Vehicles carry
plate/plate_state/lot_number/color/deposit (saveVehicleTariffs parses
<field>_<id> inputs — LONGEST prefixes first, or plate_state mangles the
id). The DISPATCH button now opens /loads/[id]/dispatch — msgplane's Edit
Dispatch Sheet (dates, carrier picker with logged-offer shortcuts, driver,
instructions, terms, money; carrier_pay via admin client) — where SAVE
keeps the sheet and SAVE AND DISPATCH assigns the carrier (still the only
dispatch path). Order detail gained the Dispatch Information band, and the
orders list msgplane's REQUESTS tab (posted orders with logged carrier
offers; the load_requests id-list feeds both filter and count — an empty
.in() list matches everything, so it's guarded with an impossible uuid).
Parity items deliberately still open: row quick-view popup, vehicle-photo
override editor, Loadboard/Campaign selects on the edit header, PRINTABLE
dispatch sheet, msgplane's ISSUES tab ("incomplete" post-delivery orders —
no such status here yet), the Payments/Payment Logs bands on order detail
(their Create Payment form is a ledger row charged through Stax — ours
waits on the processor decision), pickup/delivery date MODIFIERS on the
dispatch sheet (Estimated/Exactly/No Earlier/No Later), auto-tickets on
signed/dispatched events, and Phase-4-lite dispatch confirmation by
INGESTING CentralDispatch's notification emails (msgplane logs "ACCEPTED
by <carrier>" emails from do-not-reply@centraldispatch.com straight onto
the order — no API; their home page even warns post-dispatch CRM edits do
NOT sync back to CD).

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

## Imported book of business (2026-07-27)

441 real records migrated from msgplane with their ORIGINAL order numbers
(searchable): 100 quotes, 100 ready orders, 50 hold (all they had), 100
archived, 91 "Issues" (msgplane status `incomplete` → rests at `delivered`
here; each carries an import note with its original status + assigned rep).
423 customers deduped by email/phone, 495 vehicles. All imported loads have
`sales_owner_id` NULL — managers see everything, sales reps see none of them
until assigned. Re-runnable importer (idempotent on load_number):
`node <scratchpad>/import-msgplane.mjs` reading Downloads/msgplane-*.json.
Export path that works: in-page fetch of each record's editview → parse
name/value fields (card fields excluded in-browser) → file download from the
page (Chrome PNA blocks localhost POSTs from HTTPS pages now — the old
127.0.0.1 receiver trick no longer works in real Chrome).

## Carrier directory

~4.7k carrier companies imported from the old system (migration 0016 added
`city`, `state`, `source`; `source` = 'cd' | 'sd' | null and is why the same
company can appear twice with different contact details). Re-import or top up
with `node scripts/import-carriers.mjs <tsv>` — idempotent on name+phone.
Phone search works regardless of formatting because `phone_digits` on
customers and carriers is a **generated** column (migration 0017).

## App chrome

Horizontal blue top bar (`app-topbar.tsx`) in the style of the system this
replaces: modules left, **global search top-right**, refresh, account menu;
narrow screens get a drawer. The old dark left sidebar is gone. Order detail
follows the same pattern — ID / Status / Campaign / Loadboard / Tariff on one
header row with the lifecycle buttons on the right, E-Sign and the ⋯ menu in
the right column, "Back to list" in the footer.

## Global search

Top-bar box, **Enter to search** (no search-as-you-type — deliberate, per the
owner), landing on `/search`: the headline section is ORDERS — matching a
shipper's name/phone/email lists every order that belongs to them — then
shippers and carriers. RLS-scoped; loads read through the role view.
**Careful with PostgREST `or=(...)`**: `,` `.` `(` `)` are grammar, so every
pattern is double-quoted via `likePattern()` — a phone typed as
"(865) 328-7418" silently returned nothing before that. (/api/search still
exists and uses the same escaping.)

Also: carrier records hold their documents (COI/W-9/MC authority, private
bucket + signed URLs; COI expiry mirrors onto carriers.coi_expiry_date and
shows an EXPIRED flag), and the notes counter on any pipeline row opens a
quick-notes sheet — read and add notes with attachments without opening the
order, msgplane-style.

## Internal notes + attachments

Order detail carries a notes THREAD (migration 0018 `load_notes`), each note
stamped with author/time, editable or removable by its author (managers can do
anyone's — enforced in RLS, not just the UI), with multi-file attachments.
Files live in the **private** `load-files` bucket (create it with
`node scripts/ensure-storage.mjs`) and are only reachable through 60-second
signed URLs minted per click by `attachmentUrl()`, which re-checks note
visibility through RLS first. Attachment rows reuse the existing `documents`
table via a nullable `note_id`; deleting a note removes its objects from
storage too, so nothing is orphaned.

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
