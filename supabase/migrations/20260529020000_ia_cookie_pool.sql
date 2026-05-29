-- Internet Archive cookie pool: logged-in-user / logged-in-sig pairs for IA API access.
-- manage-ia-cookies.mjs writes via service role; workers and build scripts read via service role.
-- No anon/authenticated read policies — credentials stay server-side only.

create table if not exists ia_cookie_pool (
  id          uuid        primary key default gen_random_uuid(),
  user_value  text        not null,
  sig_value   text        not null,
  label       text        not null default '',
  enabled     boolean     not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_value)
);

alter table ia_cookie_pool enable row level security;
