-- Worker event log: populated by the client when it detects download failures.
-- The log-event Edge Function inserts here and forwards to Discord.

create table if not exists public.worker_events (
  id         bigint      primary key generated always as identity,
  type       text        not null,  -- 'worker_rate_limited' | 'all_workers_down' | 'ia_resolve_failed' | 'ia_cookie_empty'
  worker_url text,                  -- which worker origin reported the error (null for pool-wide events)
  message    text,
  created_at timestamptz not null default now()
);

create index if not exists worker_events_type_created_at_idx
  on public.worker_events (type, created_at desc);

create index if not exists worker_events_created_at_idx
  on public.worker_events (created_at desc);

alter table public.worker_events enable row level security;

comment on table public.worker_events is
  'Client-reported download errors. No RLS read policy — service role only. log-event Edge Function writes here.';
