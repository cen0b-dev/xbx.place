-- Worker pool: list of active Cloudflare download-proxy workers.
-- The frontend fetches this table at runtime (anon read) to build its proxy pool.
-- manage-workers.mjs writes to this table via service role key.

create table if not exists worker_pool (
  id          uuid        primary key default gen_random_uuid(),
  url         text        not null unique,
  worker_name text        not null default '',
  account_label text      not null default '',
  enabled     boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table worker_pool enable row level security;

-- Anyone (including anonymous visitors) can read enabled workers.
create policy "Public read enabled workers"
  on worker_pool for select
  using (enabled = true);
