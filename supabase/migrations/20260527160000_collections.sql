-- Game collections and public profile view for gamertag-based profile URLs.

-- Dedupe gamertags before adding a unique index.
with ranked as (
  select
    id,
    gamertag,
    row_number() over (
      partition by lower(trim(gamertag))
      order by created_at nulls last, id
    ) as rn
  from public.profiles
)
update public.profiles p
set gamertag = p.gamertag || '-' || substr(replace(p.id::text, '-', ''), 1, 4)
from ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists profiles_gamertag_unique
  on public.profiles (lower(trim(gamertag)));

create or replace view public.public_profiles as
select
  id,
  gamertag,
  gamerpic_url,
  banner_url,
  bio,
  created_at
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_name_len check (char_length(trim(name)) between 1 and 64)
);

create unique index if not exists collections_user_name_unique
  on public.collections (user_id, lower(trim(name)));

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  title_id text not null,
  added_at timestamptz not null default now(),
  primary key (collection_id, title_id)
);

create index if not exists collection_items_title_id_idx
  on public.collection_items (title_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at
  before update on public.collections
  for each row
  execute function public.set_updated_at();

create policy "Users can view own or public collections"
  on public.collections
  for select
  using (auth.uid() = user_id or is_public = true);

create policy "Users can insert own collections"
  on public.collections
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own collections"
  on public.collections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own collections"
  on public.collections
  for delete
  using (auth.uid() = user_id);

create policy "Users can view items in visible collections"
  on public.collection_items
  for select
  using (
    exists (
      select 1
      from public.collections c
      where c.id = collection_id
        and (c.user_id = auth.uid() or c.is_public = true)
    )
  );

create policy "Users can insert items into own collections"
  on public.collection_items
  for insert
  with check (
    exists (
      select 1
      from public.collections c
      where c.id = collection_id
        and c.user_id = auth.uid()
    )
  );

create policy "Users can delete items from own collections"
  on public.collection_items
  for delete
  using (
    exists (
      select 1
      from public.collections c
      where c.id = collection_id
        and c.user_id = auth.uid()
    )
  );

comment on table public.collections is
  'User-created game lists. Public collections are visible on profile pages.';
comment on table public.collection_items is
  'Games saved to a collection, keyed by catalog title_id.';
