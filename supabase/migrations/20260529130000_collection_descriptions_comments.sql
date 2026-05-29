-- Collection descriptions and comments on public collections.

alter table public.collections
  add column if not exists description text;

alter table public.collections
  drop constraint if exists collections_description_len;

alter table public.collections
  add constraint collections_description_len
  check (description is null or char_length(trim(description)) between 1 and 280);

create table if not exists public.collection_comments (
  id            uuid        primary key default gen_random_uuid(),
  collection_id uuid        not null references public.collections (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  body          text        not null,
  created_at    timestamptz not null default now(),
  constraint collection_comments_body_len check (char_length(trim(body)) between 1 and 500)
);

create index if not exists collection_comments_collection_created_idx
  on public.collection_comments (collection_id, created_at desc);

create index if not exists collection_comments_user_id_idx
  on public.collection_comments (user_id);

alter table public.collection_comments enable row level security;

drop policy if exists "anyone can read collection comments" on public.collection_comments;
create policy "anyone can read collection comments"
  on public.collection_comments for select
  using (true);

drop policy if exists "authenticated users can post collection comments" on public.collection_comments;
create policy "authenticated users can post collection comments"
  on public.collection_comments for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own collection comments" on public.collection_comments;
create policy "users can delete own collection comments"
  on public.collection_comments for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admins can delete any collection comment" on public.collection_comments;
create policy "admins can delete any collection comment"
  on public.collection_comments for delete to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');

create or replace view public.collection_comment_feed as
  select
    cc.id,
    cc.collection_id,
    cc.user_id,
    cc.body,
    cc.created_at,
    coalesce(p.gamertag, 'New Player') as gamertag,
    p.gamerpic_url
  from public.collection_comments cc
  left join public.profiles p on p.id = cc.user_id;

grant select on public.collection_comment_feed to anon, authenticated;

comment on column public.collections.description is
  'Optional short description shown on public collection pages.';
comment on table public.collection_comments is
  'User comments on public game collections.';
