-- IA cookie usage stats: counters on pool rows + event log for 24 h windows.

alter table ia_cookie_pool
  add column if not exists use_count bigint not null default 0,
  add column if not exists error_count bigint not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists last_validated_at timestamptz,
  add column if not exists is_valid boolean,
  add column if not exists validation_message text;

create table if not exists ia_cookie_usage (
  id         bigint generated always as identity primary key,
  cookie_id  uuid not null references ia_cookie_pool(id) on delete cascade,
  outcome    text not null default 'ok',  -- ok | resolve_fail | stream_fail | build
  created_at timestamptz not null default now()
);

create index if not exists ia_cookie_usage_cookie_created_idx
  on ia_cookie_usage (cookie_id, created_at desc);

alter table ia_cookie_usage enable row level security;

create or replace function record_ia_cookie_use(
  p_cookie_id uuid,
  p_outcome text default 'ok'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cookie_id is null then
    return;
  end if;

  insert into ia_cookie_usage (cookie_id, outcome)
  values (p_cookie_id, coalesce(nullif(trim(p_outcome), ''), 'ok'));

  update ia_cookie_pool
  set
    use_count = use_count + 1,
    error_count = error_count + case when p_outcome in ('resolve_fail', 'stream_fail') then 1 else 0 end,
    last_used_at = now()
  where id = p_cookie_id;
end;
$$;

revoke all on function record_ia_cookie_use(uuid, text) from public;
grant execute on function record_ia_cookie_use(uuid, text) to service_role;
