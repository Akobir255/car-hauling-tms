-- Phase 3: AI intake parsing.
--
-- A dispatcher pastes an email, or uploads a load sheet as a PDF or a photo,
-- and gets back a filled-in order form with a confidence value on every field.
-- Low-confidence fields are highlighted for review. NOTHING becomes an order
-- until a human presses confirm, and confirm goes through the existing
-- createLoad path — the same validation, the same pipeline rules, the same
-- history — rather than a second write path that would drift from it.
--
-- Two tables, and the second one is the point. `ai_corrections` records what
-- the dispatcher CHANGED about the extraction: the model's value, the human's
-- value, and the input that produced both. That is the eval set and the
-- fine-tuning corpus, and it only exists if it is captured at the moment of
-- correction — nobody reconstructs it later.
--
-- brokerage_id rides along on the same terms as 0049/0050: nullable, no FK, no
-- index, read by no policy. This app is single-tenant.

-- ---------------------------------------------------------------------------
-- 1. Every model call in, and out.
--
-- The brief's rule: store every AI input and output with a model, a
-- prompt_version and a created_at. That is the audit trail (what did the model
-- actually see when it produced this?) and the eval dataset (re-run prompt v2
-- against every input v1 ever saw). Both need the RAW input, not a summary.
-- ---------------------------------------------------------------------------
create table ai_extractions (
  id             uuid primary key default gen_random_uuid(),
  brokerage_id   uuid,
  -- Set once the human confirms and a load exists. Null while under review, and
  -- null forever on an extraction somebody abandoned — which is itself signal.
  load_id        uuid references loads (id) on delete set null,

  kind           text not null check (kind in ('text', 'pdf', 'image')),
  -- Pasted text lives here. A PDF or a photo lives in the private load-files
  -- bucket at input_storage_path; the sha256 is what makes two uploads of the
  -- same load sheet recognisable as one input.
  input_text     text,
  input_storage_path text,
  input_filename text,
  input_media_type text,
  input_bytes    integer,
  input_sha256   text,

  -- The audit trail proper. A row without these cannot be reproduced, and an
  -- eval set you cannot reproduce is an anecdote.
  model          text not null,
  prompt_version text not null,
  -- The strict-schema object the model returned, confidences included, exactly
  -- as parsed. Never edited in place — a correction is a row in ai_corrections.
  output         jsonb,
  -- Populated instead of `output` when the model declined or the call failed.
  -- Kept rather than discarded: a refusal on a freight document is a fact worth
  -- seeing, not an error to swallow.
  error          text,
  stop_reason    text,

  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,

  created_by     uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index idx_ai_extractions_created on ai_extractions (created_at desc);
create index idx_ai_extractions_load on ai_extractions (load_id) where load_id is not null;
create index idx_ai_extractions_sha on ai_extractions (input_sha256) where input_sha256 is not null;

alter table ai_extractions enable row level security;

-- NOT the blanket is_active_staff() read that 0037 gave the load children, and
-- the difference is deliberate. input_text is a customer's email pasted
-- verbatim: their name, their phone, their address. `customers` has scoped that
-- to the owning rep since 0001, and a table that stores the same contact
-- details as free text would route straight around it. So: your own
-- extractions, or admin/dispatcher who can already read every customer.
create policy "ai_extractions_select_scoped"
  on ai_extractions for select
  using (
    public.is_active_staff()
    and (
      created_by = auth.uid()
      or public.current_profile_role() in ('admin', 'dispatcher')
    )
  );

-- Writes come from the server action running as the caller, so the row is
-- attributable to a real person.
create policy "ai_extractions_insert_scoped"
  on ai_extractions for insert
  with check (public.is_active_staff());

-- No update policy and no delete policy. The brief calls this the audit trail;
-- an audit trail any staff member can rewrite is a note. That includes load_id
-- — if it is ever stamped it will be stamped by the service role, which is the
-- same rule margin already lives under.
revoke all on ai_extractions from anon, authenticated;
grant select, insert on ai_extractions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What the human changed. THIS IS THE ASSET.
--
-- One row per field the dispatcher corrected, holding the model's value and
-- theirs side by side, pointing back at the extraction that produced it. Append
-- only: no update policy, no delete policy, and no update or delete grant. A
-- training set somebody can quietly edit is not a training set.
-- ---------------------------------------------------------------------------
create table ai_corrections (
  id             uuid primary key default gen_random_uuid(),
  brokerage_id   uuid,
  extraction_id  uuid not null references ai_extractions (id) on delete cascade,

  -- Dotted path into the extraction output, e.g. "contact.phone" or
  -- "vehicles.0.vin" — so a correction can be replayed against the stored
  -- output without guessing which field it belonged to.
  field_path     text not null,
  model_value    text,
  -- NOT NULL, and '' rather than null when the human cleared the field. Two
  -- reasons: clearing a value the model invented is itself a correction worth
  -- keeping, and the unique index below cannot dedupe on a nullable column
  -- (null <> null), which is what stops a retried confirm from writing the same
  -- correction twice into an append-only table.
  human_value    text not null,
  -- What the model claimed about this field at extraction time. The single most
  -- useful column here: it is what tells you whether the model is confidently
  -- wrong (bad — fix the prompt) or unconfidently wrong (fine — the review
  -- screen already flagged it).
  model_confidence double precision,

  corrected_by   uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index idx_ai_corrections_extraction on ai_corrections (extraction_id);
create index idx_ai_corrections_field on ai_corrections (field_path);

-- Confirm can fail and be retried: createLoad rejects an order with no vehicle,
-- the dispatcher adds one and presses the button again. Without this the same
-- correction lands twice, and since nothing may delete from this table the
-- duplicate is permanent — a field the model got wrong once would count twice
-- in the eval set. ON CONFLICT DO NOTHING against this index makes the retry a
-- no-op, while a retry where they typed something DIFFERENT still records, which
-- is the honest history.
create unique index idx_ai_corrections_once
  on ai_corrections (extraction_id, field_path, human_value);

alter table ai_corrections enable row level security;

-- Same reasoning as ai_extractions: a correction row carries the customer's real
-- phone number in human_value.
create policy "ai_corrections_select_scoped"
  on ai_corrections for select
  using (
    public.is_active_staff()
    and (
      corrected_by = auth.uid()
      or public.current_profile_role() in ('admin', 'dispatcher')
    )
  );

create policy "ai_corrections_insert_scoped"
  on ai_corrections for insert
  with check (public.is_active_staff());

-- No update policy and no delete policy, deliberately.

revoke all on ai_corrections from anon, authenticated;
grant select, insert on ai_corrections to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dark until switched on, same as Phase 2.
-- ---------------------------------------------------------------------------
insert into feature_flags (key, enabled, note) values
  ('ai_intake', false, 'Phase 3: paste/upload intake parsing with a human-confirm review screen.')
on conflict (key) do nothing;
