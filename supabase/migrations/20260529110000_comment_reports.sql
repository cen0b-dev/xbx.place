-- User-submitted comment reports. Written by report-comment Edge Function (service role).

create table if not exists public.comment_reports (
  id               bigint      primary key generated always as identity,
  comment_id       uuid        not null references public.game_comments (id) on delete cascade,
  title_id         text        not null,
  title_name       text        not null,
  reason           text        not null,
  details          text,
  comment_excerpt  text,
  reporter_user_id uuid        references auth.users (id) on delete set null,
  page_url         text,
  created_at       timestamptz not null default now()
);

create index if not exists comment_reports_comment_created_idx
  on public.comment_reports (comment_id, created_at desc);

create index if not exists comment_reports_created_at_idx
  on public.comment_reports (created_at desc);

alter table public.comment_reports enable row level security;

comment on table public.comment_reports is
  'Client-submitted comment reports. No RLS read policy — service role only. report-comment Edge Function writes here.';
