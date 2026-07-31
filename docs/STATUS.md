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
- **NOT built**: the Mapbox dashboard map and the map on the customer page. No
  Mapbox token exists, and Mapbox GL also needs `api.mapbox.com`,
  `events.mapbox.com` in `connect-src` plus `worker-src blob:` in
  `security-headers.ts` or it fails silently under the CSP.

## AI intake (0051) — BUILT, NOT APPLIED, BLOCKED ON A KEY

`/loads/intake`: paste an email or attach a load sheet, get a filled-in order
form with a confidence on every field, correct it, press confirm. Ships behind
`feature_flags.ai_intake = false` and 404s when off. **Migration 0051 has not
been pushed and no `ANTHROPIC_API_KEY` exists in Vercel** — the page renders a
"not configured on this deployment" card rather than a broken form until it does.

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
- **Not wired**: `ai_extractions.load_id` stays null. Stamping it means owning
  the redirect and forking the creation path, which is the one thing the confirm
  action exists to avoid.

## THE WHOLE BOOK IS HIDDEN (0052 + 0053) — read this before debugging "no data"

Applied 2026-07-31 at the owner's instruction: nothing copied from US Star shows
on the platform, and **nobody** sees it — not sales, not dispatch, not an admin.
**Nothing was deleted.** If you are looking at an empty Orders page, this is why.

Hidden: 25,867 loads, 25,117 customers, 7,698 messages, 26,137 vehicles, 6,082
notes, 32,570 events, 31 load documents. Still visible: **4,740 carriers and
their 1,960 COI / W-9 / authority documents** — the stated exception.

**Restore is three statements** (Supabase SQL editor, service role):

```sql
update loads          set hidden_at = null;
update customers      set hidden_at = null;
update messages       set hidden_at = null;
update webhook_events set hidden_at = null;
```

The views and functions need no change to restore: every condition they carry
is `hidden_at is null`, which is true for every row again.

### Five sample orders are the only visible data (seeded 2026-07-31)

`10000004-US` … `10000008-US`, with fictional customers, one vehicle each, a
follow-up on all five, and paperwork spread deliberately: **2 signed, 2 sent and
unsigned, 1 never sent.** Each carries "Sample record seeded 2026-07-31 for
demo. Not a real order." in its internal notes, so nobody dispatches a truck to
one. Delete them with `delete from loads where notes like 'Sample record
seeded%'` (vehicles and events cascade; their five customers are `source =
'sample'`).

### The trap that cost THREE migrations — anything that skips RLS needs telling

Same root cause, found three times, each time only because the screen still
showed data after the table said zero:

| | What bypassed the policy | Caught by |
|---|---|---|
| 0052 | — (the hide itself) | — |
| 0053 | non-invoker **views** — `loads_full`, `loads_full_contact` | probing the view, not the table |
| 0054 | **security definer RPCs** — `dashboard_stats`, `loads_status_counts` | the owner's dashboard screenshot |

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

## Open items

- **Phase 3 needs `ANTHROPIC_API_KEY` in Vercel** (Project → Settings →
  Environment Variables, all three environments), and `supabase db push` to apply
  0051. Until both, `/loads/intake` is a card explaining it is not configured.
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
