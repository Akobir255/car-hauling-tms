-- Notes carried over from msgplane were written by people who have no account
-- here — "Leo Carter" and the rest of the old roster. author_id can only point
-- at a local profile, so importing them left the choice between attributing a
-- rep's words to nobody or attributing them to the wrong person.
--
-- Neither is acceptable in a record the owner may one day read back, so the
-- original name travels with the note instead. author_id stays null for these:
-- it means "not written by anyone in this system", which is true.

alter table load_notes
  add column if not exists imported_author text;

comment on column load_notes.imported_author is
  'Name of the msgplane user who wrote this note. Set only on imported rows, where author_id is null.';
