-- User-submitted game issue reports (broken download, wrong game, etc.).
-- The report-game Edge Function inserts here and forwards to Discord.

create table if not exists public.game_reports (
  id          bigint      primary key generated always as identity,
  title_id    text        not null,
  title_name  text        not null,
  reason      text        not null,
  details     text,
  file_label  text,
  page_url    text,
  created_at  timestamptz not null default now()
);

create index if not exists game_reports_title_reason_created_at_idx
  on public.game_reports (title_id, reason, created_at desc);

create index if not exists game_reports_created_at_idx
  on public.game_reports (created_at desc);

alter table public.game_reports enable row level security;

comment on table public.game_reports is
  'Client-submitted catalog issue reports. No RLS read policy — service role only. report-game Edge Function writes here.';
