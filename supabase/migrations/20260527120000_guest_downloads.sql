-- Tracks one free download per anonymous guest id (set by the download proxy via service role).
-- Authenticated users bypass this table entirely (verified JWT on the proxy).

create table if not exists public.guest_downloads (
  guest_id uuid primary key,
  filename text not null,
  downloaded_at timestamptz not null default now()
);

create index if not exists guest_downloads_downloaded_at_idx
  on public.guest_downloads (downloaded_at desc);

alter table public.guest_downloads enable row level security;

comment on table public.guest_downloads is
  'One row per guest browser id after their single anonymous download. No client policies; proxy uses service role.';
