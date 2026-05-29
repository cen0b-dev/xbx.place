-- User comments on base game releases (not DLC or update packages).

create table if not exists public.game_comments (
  id         uuid        primary key default gen_random_uuid(),
  title_id   text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  body       text        not null,
  created_at timestamptz not null default now(),
  constraint game_comments_body_len check (char_length(trim(body)) between 1 and 500)
);

-- Efficient lookup: all comments for a title sorted newest first.
create index if not exists game_comments_title_created_idx
  on public.game_comments (title_id, created_at desc);

-- Efficient lookup: all comments by a user (for deletion, rate checks).
create index if not exists game_comments_user_id_idx
  on public.game_comments (user_id);

alter table public.game_comments enable row level security;

-- Anyone (including anon) can read comments.
drop policy if exists "anyone can read game comments" on public.game_comments;
create policy "anyone can read game comments"
  on public.game_comments for select
  using (true);

-- Authenticated users can post comments under their own user_id.
drop policy if exists "authenticated users can post comments" on public.game_comments;
create policy "authenticated users can post comments"
  on public.game_comments for insert to authenticated
  with check (auth.uid() = user_id);

-- Users can only delete their own comments.
drop policy if exists "users can delete own comments" on public.game_comments;
create policy "users can delete own comments"
  on public.game_comments for delete to authenticated
  using (auth.uid() = user_id);

-- Read-only view exposing comments with public profile data.
-- Runs as definer (no security_invoker) so the LEFT JOIN on profiles can return
-- gamertag/gamerpic_url for all commenters — identical data to the existing
-- public_profiles view, which already exposes this non-sensitive info to anon/authenticated.
create or replace view public.comment_feed as
  select
    gc.id,
    gc.title_id,
    gc.user_id,
    gc.body,
    gc.created_at,
    coalesce(p.gamertag, 'New Player') as gamertag,
    p.gamerpic_url
  from public.game_comments gc
  left join public.profiles p on p.id = gc.user_id;

grant select on public.comment_feed to anon, authenticated;

comment on table public.game_comments is
  'User comments on base game releases. DLC and update entries should not have comments.';
