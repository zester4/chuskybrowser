-- Chusky Gateway tables for Supabase (Postgres).
-- accounts come from Supabase Auth: account_id is the auth user's id.

create table if not exists api_keys (
  id           uuid primary key,
  account_id   uuid not null,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_account on api_keys (account_id);

create table if not exists tabs (
  tab_id       text primary key,
  account_id   uuid not null,
  session_key  text not null,
  url          text,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);
create index if not exists tabs_open on tabs (account_id) where closed_at is null;

create table if not exists usage_events (
  id           bigserial primary key,
  account_id   uuid not null,
  kind         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists usage_events_day on usage_events (account_id, created_at);
