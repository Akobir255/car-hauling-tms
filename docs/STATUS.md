# Project state — read this before changing anything

US Star Trucking's broker TMS. Replaces a paid SuiteCRM-based system (msgplane,
$250/mo + $50/user). Live at **https://carshiphelp.com** for a team of ~48.

Last updated: 2026-07-31 (late evening — the GPS/AI build-out pass).

## Stack

- Next.js 16 (App Router, TS, Turbopack). Middleware lives in `src/proxy.ts`.
- Supabase (project `fqcqxlpprwuilnbsztzm`, us-east-1). RLS everywhere.
- Tailwind v4 + shadcn on Base UI. **Button takes a `render` prop, not `asChild`.**
- Vercel. Domain on Cloudflare (grey-cloud/DNS-only for the app records).

## Commands

```
npm run dev        npm run lint      npx tsc --noEmit
npm test           # 141 unit tests, no network
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
   - **`carrier_pay` is not automatically a fact.** It is DERIVED at creation as
     `customer_rate − deposit_amount` — the offer posted to CD/SD — and only
     becomes a settlement when a human types the real figure on the dispatch
     sheet. `carrier_pay_confirmed` (0038) is what tells the two apart, and any
     margin report must filter on it. When 0038 landed, 195 of 25,848 priced
     loads were confirmed — 13 of 91 *delivered* ones. Do not aggregate that
     column without the flag.

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

## The event spine (0049)

`load_events` is the one timeline every new feature writes onto — append-only,
`(load_id, occurred_at desc)`, with `source` in user | gps | sms | call | ai |
integration. Written ONLY through `recordEvent()` in `src/lib/events/`.

- **Append-only twice over**: no update/delete policy AND no update/delete grant
  to `authenticated`. Policy alone is what left `documents` wipeable by any
  staff session.
- **Reads are `is_active_staff()`, writes are `user_can_access_load()`.** The
  first draft got this wrong and gated reads on ownership, which silently blanks
  the History band for a rep looking at a colleague's order — 0037 had already
  removed that predicate from every child of a load for exactly that reason. RLS
  returns zero rows rather than an error, so the regression is invisible.
  `tests/events.test.ts` now pins both halves.
- **Nothing margin-bearing may go in `payload`.** It is readable by all staff,
  so a jsonb blob routes straight around the column grants that hide margin from
  sales (rule 1). A margin-bearing event needs its own table.
- `load_status_history` is now a **view** over it (`security_invoker`), with an
  INSTEAD OF INSERT trigger so the 15 existing writers keep working while they
  move to `recordEvent()` one at a time. Applied 2026-07-30: 32,570 rows
  backfilled with their original ids, all 32,570 visible through the view.
- `scripts/backup.mjs` backs up `load_events`, not the view — this project has
  no PITR, so that file is the only copy.

## GPS tracking (0050) — SHIPPED DARK

Applied 2026-07-30 with `feature_flags.gps_tracking = false`. Nothing below is
reachable until an admin flips that row; both public pages and the ingest route
check it and 404 when it is off.

- `shipment_locations` (positions), `geofence_events` (arrival/departure),
  `load_geofences` (the centres), `tracking_tokens`, `feature_flags`.
- **`authenticated` cannot write positions at all** — select only. The single
  writer is `/api/track/[token]`, running as the service role after validating
  the token. There is no anon-writable table in this schema and this did not
  add one.
- **Two no-login URLs**, same contract as `/sign/[token]`: `/t/<token>` is the
  driver's location page (write), `/track/<token>` is the customer's (read-only,
  and it never SELECTS carrier, rates or contact details — redaction by not
  fetching). `kind` is checked on every resolve so a customer's token cannot
  post positions.
- **Geofence dedup is three mechanisms**, because one is not enough: hysteresis
  (enter at the radius, leave at 1.5x it), a dwell of 2 agreeing fixes, and a
  unique index `(load_id, fence, transition)` as the backstop. The tradeoff: a
  genuine second visit to a fence is not recorded. `tests/geofence.test.ts`
  simulates an idling truck across the boundary and asserts one arrival.
- **Geofence centres are geocoded lazily**, when a driver link is issued — one
  ORS call pair per tracked load, not a 26k backfill. An address that will not
  geocode simply gets no fence; positions still record.
- Coordinates deliberately live in `load_geofences`, NOT on `loads`: a column on
  `loads` would trigger 0013's checklist (grant it, then recreate all four
  frozen `select *` views).
- `shipment_locations` is in the `supabase_realtime` publication. RLS applies to
  `postgres_changes`, so a subscriber gets only what its select policy allows.
- **`Permissions-Policy` in `next.config.ts` must keep `geolocation=(self)`.**
  It was `geolocation=()` — an EMPTY allowlist, which denies the API to every
  origin including our own — so the driver page could never get a fix and would
  tell the driver to change a browser setting that would not have helped. Set it
  back to `()` and Phase 2 is silently dead again.
- **Geofences are evaluated on every accepted ping, stored or not.** A truck at
  highway speed lands at most ONE stored fix inside a 500m radius before it
  parks, and every ping after that is filtered out as "not a real move" — so
  gating evaluation on storage meant arrival never fired, and since departure is
  gated behind arrival, the feature emitted nothing at all. `tests/geofence.test.ts`
  pins both directions of this.
- **Built 2026-07-31 (evening): the consumption side.** Both maps exist on
  **Leaflet + OSM, not Mapbox** — leaflet was already a dependency (the quote
  form's route-map) and `tile.openstreetmap.org` already in img-src, so the
  Mapbox plan above was solving a problem we didn't have. Zero CSP change.
  `src/components/tracking/` draws trail (last 200 fixes), both fences and a
  last-position marker on the order page — the FIRST subscriber of the 0050
  realtime publication, with a 45s polling fallback on channel error — and a
  slimmer variant on `/track/<token>` (deliberately NO fence circles there: a
  fence centre is the address). All staff reads go through the caller's RLS
  client. The TrackingPanel now shows live token state + last driver ping and
  a "Text to driver" button (via `runSmsChunk`, single recipient, logged to
  messages); `issueTrackingLink` refuses pre-order stages server-side, gained
  the `VERCEL_PROJECT_PRODUCTION_URL` fallback, and returns geocode failures
  to the UI instead of a server-only console.warn.
- **Driver page survivability (same pass):** screen wake lock (re-acquired on
  visibilitychange, which also triggers an immediate fix), failed posts
  buffered in localStorage with their original `recorded_at` (cap 50, pruned
  at the 24h backdate window, drained one per cycle inside the 25s rate
  limit — the client finally uses the backdating the server always
  supported), a minimal `public/driver-tracking.webmanifest`, and honest
  on-page guidance that tracking stops when the screen is off. Delivery-fence
  DEPARTURE now auto-revokes the driver token and records
  `tracking_link_revoked` on the spine (customer token deliberately stays
  alive). `event_type` is unconstrained TEXT in 0049, so no migration was
  needed for the new type. Still open: road-distance/ETA via ORS.

## AI intake (0051) — BUILT AND APPLIED, BLOCKED ON THE KEY ONLY

`/loads/intake`: paste an email or attach a load sheet, get a filled-in order
form with a confidence on every field, correct it, press confirm. Ships behind
`feature_flags.ai_intake = false` and 404s when off. **Migration 0051 IS
applied** — it rode along with the 0052–0060 push; verified 2026-07-31 with
`supabase migration list` (0051 present remote) and a live REST probe (both
tables answer, zero rows). An earlier version of this file said it was
unpushed; that claim cost a near-miss `db push --include-all`. **Only
`ANTHROPIC_API_KEY` is missing in Vercel** — the page renders a "not
configured on this deployment" card until it exists.

- **Hardened 2026-07-31 (evening):** the Anthropic client carries
  `timeout: 90_000` and the intake page exports `maxDuration = 120` (segment
  config on the PAGE is what covers its server actions), so a platform kill
  can no longer outrun the never-throw handling and the audit insert.
  `output_config.effort = "medium"` (adaptive thinking stays on) trims the
  Opus 5 default-high thinking spend. Confidence is schema-bounded 0..1 (an
  out-of-range-high value used to suppress the "check" chip). The accept
  list names the four real image types — `image/*` invited iPhone HEIC that
  the API rejects only after upload. Text + file submissions now send BOTH
  to the model and store `input_text` alongside. Storage keys are sanitized.
  `contact.company` reaches `createLoad` as `customer_company` (new
  customers only).

- **The AI never commits anything.** READ produces a draft; CONFIRM is a human
  pressing a button, and it calls the ordinary `createLoad` rather than a second
  write path — same validation, same lead/quote rules, same history.
- `ai_extractions` stores every call, **including the failures** — a refusal and
  a timeout are rows too, with `model`, `prompt_version`, tokens and latency.
  `ai_corrections` stores what the human CHANGED, with the model's own
  confidence beside it: that column is what separates confidently-wrong (fix the
  prompt) from flagged-and-fixed (the review screen working).
- **Both tables are append-only and both are scoped to their author** (or
  admin/dispatcher). Not `is_active_staff()` like the 0037 load children:
  `input_text` is a customer's email verbatim, and `customers` has been scoped to
  the owning rep since 0001.
- **What is on screen is what `createLoad` gets.** Every field posts twice —
  `f:<path>` for the correction diff, and its `createLoad` name for the order —
  and both carry the EDITED value. Building the `vehicles_json` blob from the
  extraction instead recorded a corrected VIN in `ai_corrections` and shipped the
  model's original; `vehiclesPayload()` in `src/lib/ai/intake-schema.ts` is now
  the only thing that builds it, and `tests/ai-intake.test.ts` pins it.
- **`serverActions.bodySizeLimit` in `next.config.ts` is load-bearing here.** The
  default is 1 MB, under most phone photos, and it fails as a framework error the
  intake screen cannot explain. It is 4 MB against the 3.5 MB the intake path
  enforces itself — and both sit under the 4.5 MB body Vercel rejects at the
  platform, where no limit of ours is consulted.
- Correction writes are `ON CONFLICT DO NOTHING` against
  `(extraction_id, field_path, human_value)`. Confirm can fail and be retried,
  and nothing may delete from that table.
- **`load_id` IS wired (2026-07-31 evening)**, without forking the creation
  path: `confirmIntake` sets `ai_extraction_id` on the FormData it already
  hands to the ordinary `createLoad`, and `createLoad` stamps
  `ai_extractions.load_id` via the admin client after its insert succeeds —
  UUID-validated, first-write-wins (`.is("load_id", null)`), non-fatal on
  failure, redirect untouched. 0051 pre-authorized exactly this (service-role
  stamp, same rule margin lives under). Confirmed and abandoned extractions
  are now distinguishable, which is what every future quality metric keys on.

## THE WHOLE BOOK IS HIDDEN (0052 + 0053) — read this before debugging "no data"

Applied 2026-07-31 at the owner's instruction: nothing copied from US Star shows
on the platform, and **nobody** sees it — not sales, not dispatch, not an admin.
**Nothing was deleted.** If you are looking at an empty Orders page, this is why.

Hidden: 25,867 loads, 25,117 customers, 7,698 messages, 26,137 vehicles, 6,082
notes, 32,570 events, 31 load documents. Still visible: **4,740 carriers and
their 1,960 COI / W-9 / authority documents** — the stated exception.

**Restore is three statements** (Supabase SQL editor, service role):

```sql
alter table messages         alter column hidden_at drop default;
alter table webhook_events   alter column hidden_at drop default;
alter table sms_suppressions alter column hidden_at drop default;

update loads            set hidden_at = null;
update customers        set hidden_at = null;
update messages         set hidden_at = null;
update webhook_events   set hidden_at = null;
update sms_suppressions set hidden_at = null;
```

**Undoing the defaults is not optional.** `webhook_events` (0055) and
`sms_suppressions` (0056) default `hidden_at` to `now()`, and `messages` is
stamped by `trg_messages_default_hidden` (0060) — so without also running

```sql
drop trigger if exists trg_messages_default_hidden on messages;
alter table webhook_events   alter column hidden_at drop default;
alter table sms_suppressions alter column hidden_at drop default;
```

the next inbound text hides itself and the restore looks broken.

**Outbound SMS is exempt (0060).** A text sent from the app stays visible;
inbound still arrives dark. Not a hole: you can only text a customer you can
see, every real customer is hidden, and there is no visible inbound thread to
reply into. Existing messages were NOT backfilled — outbound included, since
those carry real numbers.

The views and functions need no change: every condition they carry is
`hidden_at is null`, which is true for every row again.

### Eighteen sample orders are the only visible data (seeded 2026-07-31)

`10000004-US` … `10000023-US` (less `…014` and `…017`, removed on request), with
fictional customers, one vehicle each, a follow-up on **all eighteen**, and
paperwork at **10 signed, 4 sent and unsigned, 4 never sent.** Statuses run
quote (9) → booked (3) → dispatched (2) → picked_up (2) → delivered (2) so every
pipeline tab has something in it. Three customers are SMS opted out, each with
the verbatim text behind it (`sms_opt_out_source`) and a `sms_suppressions` row;
two of those also opted out of email.

Each carries "Sample record seeded 2026-07-31 for demo. Not a real order." in
its internal notes, so nobody dispatches a truck to one. Remove them with
`delete from loads where notes like 'Sample record seeded%'` — vehicles and
events cascade; their customers are `source = 'sample'`.

Everything they produce is derived, not typed in: the dashboard reads 18 new
loads, $17,810 over 30 days and 8 follow-ups due, which is exactly these
eighteen records and nothing else.

### The trap that cost THREE migrations — anything that skips RLS needs telling

Same root cause, found three times, each time only because the screen still
showed data after the table said zero:

| | What bypassed the policy | Caught by |
|---|---|---|
| 0052 | — (the hide itself) | — |
| 0053 | non-invoker **views** — `loads_full`, `loads_full_contact` | probing the view, not the table |
| 0054 | **security definer RPCs** — `dashboard_stats`, `loads_status_counts` | the owner's dashboard screenshot |
| 0055 | **a table with no load_id or customer_id** — `sms_suppressions`, 129 rows keyed on a real mobile number | counting rows in a verification script |
| 0055 | **live inbound SMS**, which "hide the past" let straight back in | same count, an hour later |
| 0056 | **STOP replies** — 0055 gave the default to two inbound tables and missed the third | 4 visible suppressions against 3 opted-out samples |

0054 is the one to remember: with all 25,867 loads hidden and the Recent Loads
table correctly empty, the dashboard still read **171 new loads, $569,690
revenue, 18,227 follow-ups due and 26,137 vehicles**, because a `security
definer` function runs as its OWNER and the row policy never applies. Both
functions keep that mode on purpose — the fix is a `hidden_at is null` per
subquery, not a change of mode.

`webhook_events` went the same way in 0054: the inbound-SMS diagnostics panel
prints `from_addr`, a real customer's mobile number, with the message body in
`raw`.

**Rule: if you add a view, an RPC, or any aggregate over a table with row
rules, verify through the thing users actually read.** Checking the base table
proves nothing.

**Second rule, from 0055: "hides the past, not the future" is only right for
rows a human creates on purpose.** Inbound SMS is not — customers keep texting
the RingCentral number, and 3 messages and 18 webhook receipts had surfaced
within the hour. `messages.hidden_at` and `webhook_events.hidden_at` therefore
default to `now()`. Loads and customers keep the nullable default, which is
what lets the sample orders be visible.

**Opt-outs are still ENFORCED while hidden.** `is_phone_suppressed()` is
SECURITY DEFINER, so the send guard reads the list without anyone being able to
browse it. Verified live: `true` for an opted-out number, `false` for one that
never opted out. Nobody who asked not to be texted will be.

### The trap in detail — non-invoker views bypass RLS

0052 hid `customers` with a row policy and verified it: a signed-in admin
reading `customers` got zero rows. **That verification was not enough.**
`loads_full` and `loads_full_contact` are `security_barrier` and NOT
`security_invoker`, so they run as the view owner and the base table's RLS is
evaluated as the owner — who is not subject to it. Measured on production:

```
service role: customers with last_sms_at set            2657
ADMIN via loads_full_contact, same data                 2767   <- leaked
```

**`loads_full` must STAY non-invoker** — it is how a manager reads `carrier_pay`
at all, since 0013 revokes that column from `authenticated` and an invoker view
would hit the revoke. So the condition goes INSIDE the view (`and hidden_at is
null`, and `and c.hidden_at is null` on the customers join), never on the flag.
`loads_sales_safe*` are invoker, so reps never saw it — it was manager-only.

**If you add a view over a table with row-level rules, check its invoker mode,
and verify through the view, not just the table.**

### How the hiding works

- One nullable `hidden_at` on `loads`, `customers`, `messages`; the SELECT
  policy requires it to be null. No role exemption — admins included.
- **Children follow the parent** by `exists (select 1 from loads l where l.id =
  child.load_id)`. That EXISTS runs under the caller's RLS, so a hidden load
  makes its children unreadable with no second marker to keep in step. Without
  it, `/rest/v1/load_vehicles` still served 26,137 VIN rows while the UI showed
  nothing.
- **Two `for all` policies had to be split** (`load_vehicles_write_scoped`,
  `documents_write_staff`). FOR ALL covers SELECT and permissive policies are
  ORed, so either one would have handed every read straight back.
- **This hides the past, not the future.** `hidden_at` is nullable with no
  default, so anything created from now on is visible immediately.
- **The service role still sees everything, deliberately**, so the RingCentral
  webhook still matches inbound texts, dedupe still works, and sending still
  resolves a recipient. None of it renders.

### Verified as real signed-in sessions, admin and sales

```
                     admin  sales  service role
loads_full               0      0       (25867 in the table)
customers                0      0        25117
messages                 0      0         7698
load_vehicles            0      0        26137
load_events              0      0        32570
carriers              4740   4740         4740
carrier documents     1960   1960         1960
loads_full_contact w/ customer data: 0   (was 2767)
```

## Customer records and SMS (0052) — superseded by the section above

Applied 2026-07-31 at the owner's instruction: nothing copied from US Star
should be visible on the platform, and **nobody** should see it — not sales, not
dispatch, not an admin. **Nothing was deleted.** All 25,117 customers and 7,698
messages are in their tables with every column intact.

- **One nullable `hidden_at` column on `customers` and `messages`**, backfilled
  to now() for every row that existed, and the SELECT policy requires it to be
  null. Enforced by RLS, not by app code: a `where` clause somebody forgets is
  exactly how this kind of hiding leaks — a page nobody remembered, an export, a
  search box. There is no role exemption; an admin session reads zero rows.
- **Verified with a real signed-in admin**, not by reading the policy: 0
  customers, 0 messages, while carriers (4,740), loads (25,867), vehicles
  (26,137) and documents (1,991) all still read normally.
- **This hides the past, not the future.** `hidden_at` is nullable with no
  default, so a customer created tomorrow and an SMS arriving tomorrow are both
  visible immediately. Confirmed by inserting one and seeing it appear.
- **The service role still sees everything, deliberately** — so the RingCentral
  webhook still matches an inbound text to its customer, `find_customer_by_phone`
  and createLoad's email/phone lookup still dedupe, and outbound send still
  resolves a recipient. None of it renders anywhere.
- **To bring it all back** (Supabase SQL editor, service role):
  `update customers set hidden_at = null;` and
  `update messages set hidden_at = null;` That is the entire restore.
- **NOT covered**: `loads.pickup_contact_name/phone/cell` and the delivery
  equivalents — site contacts that are columns on `loads`, and a policy cannot
  blank a column. They still print on dispatch sheets. Moving them to a shadow
  table is a 0053 if asked.
- Carriers, their contacts, COI and authority were explicitly left alone.

## Lane pricing (0057/0058) — SHIPPED DARK

`feature_flags.lane_pricing = false`. The quote screen suggests a price from our
own history, the order page asks why a quote died, and both disappear when the
flag is off.

**What it is NOT, and this matters.** The brief asks for a gradient-boosted
regression on CARRIER COST. That is not buildable here and shipping it anyway
would be worse than shipping nothing:

```
carrier_pay populated        25,866 loads
carrier_pay_confirmed           195 loads
```

The other 25,671 were *derived* at creation as `customer_rate − reservation fee`
(0038, createLoad). A model trained on them learns an arithmetic identity,
scores near-perfectly and knows nothing about the market — the dangerous kind of
wrong. **The carrier-cost model stays blocked until confirmed carrier pay
accumulates on dispatch sheets.** `distance_miles` is set on 2 of 25,867 rows,
so there is no distance feature either.

**Why STATE pairs.** Measured, not assumed: 24,483 distinct city pairs yield 42
lanes with ≥5 samples. State pairs yield 553 with ≥10, covering 80.9% of
history. City-level pricing is an absent dataset, not a modelling choice.

- **`lane_price_stats`** — 539 published lanes, keyed origin state × destination
  state × vehicle class × transport, holding p25/median/p75 and won/lost counts.
  Rebuilt by `refresh_lane_price_stats()`, service-role only (verified: anon,
  sales AND admin all get 42501).
- **The ten-load floor is the privacy guard, not just a statistical one.** These
  aggregates are computed over the 25,867 HIDDEN loads — that history is the
  whole point — so `having count(*) >= 10` in SQL is what stops a published row
  describing one customer's price. Enforced again in `pickLane()`.
- **The median is what we typically QUOTE, not what wins.** Only 796 loads ever
  reached a won state against 6,612 cancelled — a 10.7% win rate, one or two
  wins per lane. Win rate is withheld entirely below 10 decided quotes rather
  than printing "60%" off five loads.
- **`quote_outcomes`** — append-only, the asset. 6,612 cancelled quotes in this
  book have no recorded reason because there was nowhere to put one. Captures
  outcome, reason, our price and *the competitor's price*, which is the
  expensive field and the one that makes the rest mean something.
- **`price_overrides`** — append-only; suggested vs. typed, with sample size, so
  "overrode a median of 12" and "of 400" read differently.
- `pg_safeupdate` rejects a bare `DELETE`, even inside a SECURITY DEFINER
  function — hence `delete … where true` in 0058.

- **2026-07-31 evening — the loops got closed.** The suggestion band is a
  shared component (`src/components/pricing/lane-suggestion.tsx`) on BOTH
  pricing forms — the edit form is where leads actually get priced (lead→
  quote happens BY PRICING, including on edit), and it had nothing.
  `recordPriceOverride` finally has call sites: suggested-vs-typed records
  fire-and-forget from both forms (`load_id` null on the new form — 0057
  already made the column nullable), gated on the rate actually changing.
- **Refresh is now a daily Vercel cron** (`vercel.json` →
  `/api/cron/refresh-lanes`, 09:00 UTC), which timing-safe-checks
  `Authorization: Bearer CRON_SECRET` then calls the refresh via the admin
  client. `/api/cron` had to join `SELF_AUTHENTICATING_PREFIXES` in
  `src/lib/supabase/proxy.ts` — the scheduler sends no cookie, and the
  middleware's 307-to-/login would have made every run "succeed" against
  login-page HTML. Manual refresh still works the old way.
- **Migration 0061 (UNAPPLIED — the only one)** folds `quote_outcomes` into
  `n_won`/`n_lost` (won = won-status OR won outcome; lost = cancelled/lost
  status OR lost/expired outcome, never double-counting), preserving
  SECURITY DEFINER + revokes + the `delete … where true` safeupdate
  workaround + the ≥10 privacy floor. Pinned by tests.
- **The carrier-cost blocker got its accelerant:** the dispatch sheet now has
  a marker-guarded "this is the settled figure" checkbox, threaded into
  `saveDispatchSheet`, and `isConfirmedCarrierPay` accepts it — so a
  settlement EQUAL to the derived offer (the common case, structurally
  unconfirmable before) can finally be recorded. `storedConfirmed` is now a
  never-demote floor.

## Exception engine (0059) — SHIPPED DARK

`feature_flags.exception_engine = false`. A **Needs attention** card on the
dashboard, above Follow-ups: work going wrong whether or not anyone chose to
look at it.

The brief's version compares live GPS against a routing ETA and drafts the
customer notification. Both are parked — GPS is dark and untested, the notice
needs the AI key. What ships is the middle third: score, queue, acknowledge.

- **The score is TypeScript, not SQL, and that is the point.** Every signal is
  already a column, and `src/lib/risk/score.ts` runs over `loads_full` /
  `loads_sales_safe` — so RLS, the 0013 column grants and `hidden_at` all apply
  without this feature having its own opinion about any of them. A SECURITY
  DEFINER scorer would have been the sixth thing in one day to bypass a row
  policy. Migration 0059 contains **no function at all**, asserted in a test.
- Factors: delivery overdue, pickup overdue, no carrier (weighted up when
  pickup is within 2 days), unsigned agreement, overdue follow-up, and nothing
  recorded for a week while moving. Quotes and delivered orders are excluded —
  neither can be late.
- **Two ways to be urgent**, because a pure sum gets it wrong. Found on the real
  sample set: a delivery two days late summed to 42 and landed in "watch" while
  three moderate problems summed to 77 and shouted. The late delivery is the one
  with a customer in a driveway. So `sum >= 45` **or** any single factor `>= 30`.
- **`daysUntil` anchors DATE columns at noon on both sides.** Anchoring only the
  date — the obvious version — makes today read as −1 from lunchtime onward,
  which would have put every active order in the queue as overdue. Pinned by a
  test.
- **`risk_acknowledgements` is per-FACTOR, not per-order**: "I know it has no
  carrier" must not also silence "it is three days past delivery". DELETE is
  allowed — unlike the audit tables, this is working state, and "actually, that
  is not handled" has to be expressible. An expired `snoozed_until` stops
  counting.
- Sample orders carry promise dates and carriers so this is demonstrable: with
  the flag on, 5 of 18 surface — two urgent, and a late delivery.
- **2026-07-31 evening — the queue can be worked, and GPS feeds it.** Per-row
  **Handled** (acks that row's worst factor) and **Snooze 3d** (whole-order,
  `factor` null) buttons on the card, via `risk-actions.ts` writing through
  the caller's RLS client; `acknowledged.has("*")` now actually silences a
  whole order, which the dashboard's null→`"*"` mapping always promised and
  `assess()` never honored. `daysUntil` truncates timestamps toward zero —
  a follow-up one HOUR late used to read "due 1 day ago" (floor(-0.04) =
  -1) and `stale` fired at 6.5 days. With `gps_tracking` on, the scorer
  gains `position_stale` (25 — tracking live but silent 8h+, also the alarm
  for the phone-locked driver page) and `pickup_dwell` (20 — arrived, never
  departed after 24h), and a fix in the last 24h SUPPRESSES the
  `updated_at`-based stale factor (a pinging truck is not an abandoned
  order). First entry into the high band writes `risk_flagged` onto the
  spine (check-then-insert dedupe, margin-free payload). The 500-row query
  now orders by `delivery_eta` asc nulls-last so the cap degrades toward
  the urgent, not the arbitrary. Still TypeScript, still no SQL function.

**Stale comment worth knowing about:** the dashboard's "Needs a carrier" card is
gated on `canSeeMargin` with a comment claiming `carrier_id` is not in
`loads_sales_safe`. Probed with a real sales session — it **is** readable. The
card is being hidden from reps for no reason. Left alone because un-hiding it
changes what reps see.

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

## Pipeline lists = a clone of the old system's — except the ROW

Tabs, column labels, per-tab date columns, statuses and paging are copied
from the system this replaces (audited live, 2026-07-27). The row itself is
deliberately NOT a clone since 2026-07-29: same information and same column
logic, its own look.

- The **Orig/Dest tags are gone from the row**; a stacked Tariff / Deposit /
  Carrier pricing block stands in their place, on both column layouts, so
  neither carries a second money column at the end. The lane still lives in the
  row's quick view — if that popup ever goes, the route loses its last place on
  the list.
- A **secondary contact line** sits under the shipper: the order's pickup
  contact, else its delivery contact, else the customer's company name.
- Rows are **cards** (border + 2px lift + 8px gap, `border-separate`) with a
  status-coloured **left stripe**, drawn on the CELLS — see the comment on the
  negative shadow spread before touching it. Colours come from the `--ord-*`
  token family in `globals.css`, which is US Star's brand navy rather than
  msgplane's link blue, and stripes from `STATUS_STRIPES` in `status-tone.ts`
  (still the one file allowed to decide a status colour).
- Phone cards carry the same block, the same stripe and the same second line —
  the two layouts must not drift.

- Orders module tabs: Orders · Posted CD · Posted SD · Requests · Not Signed
  · Dispatched · Issues · Picked-Up · Hold · Archived. There is no Delivered
  and no Lost tab — Archived holds both completed and lost work, and each row
  keeps showing its own word. Issues = their "incomplete" (delivered, still
  something open) and is the one tab with a red count badge.
- Quotes/Leads tabs: Follow-up Today · Quotes/Leads · Hold · Archived.
  Follow-up Today is drawn FIRST but the nav link lands on Quotes —
  `OrderTab.default` marks the landing tab, which is NOT the same as bar order.
- Each tab renames the second column and reads a different date: Converted /
  Posted / Received / Sent / Signed / Picked UP / Delivered / Archived.
- Posted CD and Posted SD filter on the BOARD TIMESTAMPS, not status, so an
  order posted to both boards appears under both (as it does there).
- **Not Signed is a live queue**: contract sent, still unsigned, on a working
  order (`NOT_SIGNED_STATUSES`). Defining it as "any order with no signature"
  swept in every archived record ever imported and showed hundreds.
- 100 rows per page with a real pager, and every tab count is an exact
  `head:true` count — the old client-side tally silently capped at 1000 rows.
- Imported records carry the source's own status word in
  `loads.msgplane_status` (migration 0021) and the list displays it.

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

## The font is SELF-HOSTED — do not switch it back to next/font/google

`src/app/layout.tsx` loads Lato from `src/app/fonts/*.woff2` via
`next/font/local`. The Google loader fetches at BUILD time, so every deploy
depended on fonts.googleapis.com answering — it failed **three separate times on
2026-07-31**, each with `Error while requesting resource`, which says nothing
about fonts and looks like a broken build. Verified after the switch: two
consecutive clean builds, both weights `loaded` in the browser, fonts served
from `/_next/static/media/`, and **zero requests to Google** across 45 captured.
Lato is OFL-1.1, so shipping the files is permitted. Same face, same subsets —
nothing changed visually.

## Open items

- **Phase 3 needs `ANTHROPIC_API_KEY` in Vercel** (Project → Settings →
  Environment Variables, all three environments), then a redeploy. That is
  the WHOLE remaining blocker — 0051 is already applied (see the AI intake
  section; the old claim here that it needed a push was stale).
- **`CRON_SECRET` in Vercel** (all environments) — the daily lane-refresh
  cron 503s without it. Then `npx supabase db push` for **0061**, the only
  unapplied migration.
- **Flag flips are now a command**: `node scripts/set-flag.mjs <key> on|off`
  (service role, refuses unknown keys) instead of freehand SQL. The four
  dark features stay dark until an operator runs it.
- **First GPS flip needs a live check**: confirm the realtime channel
  reaches SUBSCRIBED with a staff session (polling fallback hides a silent
  failure at 45s staleness), then pilot one driver link on a phone that is
  mounted and plugged in.
- `scripts/backup.mjs` now covers the post-0050 tables (`ai_extractions`,
  `ai_corrections`, `quote_outcomes`, `price_overrides`,
  `risk_acknowledgements`, `lane_price_stats`) — the append-only asset
  tables had been sitting in a no-PITR project with no backup at all.
- **Phone numbers are stored E.164 as of Phase 3** — `storedPhone()` in
  `src/lib/messaging/ringcentral.ts`, applied on customer create/update and on
  every phone column in `coreValues()`. A number it cannot read (an extension, a
  7-digit local, a foreign line) keeps the text the rep typed. **Rows written
  before this are NOT backfilled**, so both shapes exist in the columns; every
  screen renders through `formatPhone()`, which normalises for display, and
  `find_customer_by_phone` matches on the last 10 digits, so neither cares.
- **Drop `load_status_history_pre_0049`** once 0049 is confirmed good in
  production. It is the rollback copy — locked (grants revoked, RLS on, no
  policy) in the same migration that made it, unlike
  `messages_backup_pre_0013`, which is still sitting in the schema holding every
  pre-2026-07-25 message body. Dropping it also retires the
  `["load_status_history_pre_0049", "changed_by"]` entry in the admin
  AUTHORSHIP list, which exists only because that copy keeps a NO ACTION foreign
  key to `profiles` and would otherwise make `deleteUser` fail outright.
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
