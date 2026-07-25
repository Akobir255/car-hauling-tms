-- Email blasts: messages need a subject line (SMS has none).
alter table messages
  add column if not exists subject text;
