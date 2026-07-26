-- Internal notes as a THREAD on a load, with file attachments — replacing the
-- single free-text box. This is how the old system worked and how the team
-- actually operates: each note is stamped with who wrote it and when, can be
-- edited or removed by its author (or a manager), and can carry files —
-- typically a carrier's certificate of insurance or vehicle condition photos.
--
-- Attachments reuse the existing `documents` table (entity_type/entity_id +
-- storage_path) so there is one place that knows about uploaded files; a
-- nullable note_id links a document to the note it was attached to.

create table if not exists load_notes (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references loads (id) on delete cascade,
  body text not null default '',
  author_id uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_load_notes_load_created
  on load_notes (load_id, created_at desc);

alter table documents
  add column if not exists note_id uuid references load_notes (id) on delete cascade;

create index if not exists idx_documents_note_id on documents (note_id);
create index if not exists idx_documents_entity on documents (entity_type, entity_id);

alter table load_notes enable row level security;

-- Same visibility rule as every other child of a load: managers see all,
-- sales see their own customers' loads (0013's definer helper).
create policy "load_notes_select_scoped"
  on load_notes for select
  to authenticated
  using (public.user_can_access_load(load_id));

create policy "load_notes_insert_scoped"
  on load_notes for insert
  to authenticated
  with check (public.user_can_access_load(load_id) and author_id = auth.uid());

-- A note is editable by its author; managers can fix or remove anyone's.
create policy "load_notes_update_own_or_manager"
  on load_notes for update
  to authenticated
  using (
    public.user_can_access_load(load_id)
    and (author_id = auth.uid() or public.current_profile_role() in ('admin', 'dispatcher'))
  )
  with check (public.user_can_access_load(load_id));

create policy "load_notes_delete_own_or_manager"
  on load_notes for delete
  to authenticated
  using (
    public.user_can_access_load(load_id)
    and (author_id = auth.uid() or public.current_profile_role() in ('admin', 'dispatcher'))
  );
