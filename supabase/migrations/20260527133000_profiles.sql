-- User profile metadata for signed-in accounts.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  gamertag text not null default 'New Player',
  gamerpic_url text,
  banner_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, gamertag)
  values (
    new.id,
    new.email,
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'New Player')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_profile_after_user_signup on auth.users;
create trigger create_profile_after_user_signup
  after insert on auth.users
  for each row
  execute function public.create_profile_for_new_user();

comment on table public.profiles is
  'Profile metadata for signed-in xbx.place users. Users can view and edit only their own row.';
