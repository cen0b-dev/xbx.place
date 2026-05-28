-- Public profile image storage (gamerpic + banner uploads).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'gamerpics',
    'gamerpics',
    true,
    524288,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'profile-banners',
    'profile-banners',
    true,
    2097152,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read gamerpics" on storage.objects;
drop policy if exists "Users insert own gamerpic" on storage.objects;
drop policy if exists "Users update own gamerpic" on storage.objects;
drop policy if exists "Users delete own gamerpic" on storage.objects;
drop policy if exists "Public read profile banners" on storage.objects;
drop policy if exists "Users insert own banner" on storage.objects;
drop policy if exists "Users update own banner" on storage.objects;
drop policy if exists "Users delete own banner" on storage.objects;

create policy "Public read gamerpics"
  on storage.objects
  for select
  using (bucket_id = 'gamerpics');

create policy "Users insert own gamerpic"
  on storage.objects
  for insert
  with check (
    bucket_id = 'gamerpics'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users update own gamerpic"
  on storage.objects
  for update
  using (
    bucket_id = 'gamerpics'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'gamerpics'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own gamerpic"
  on storage.objects
  for delete
  using (
    bucket_id = 'gamerpics'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Public read profile banners"
  on storage.objects
  for select
  using (bucket_id = 'profile-banners');

create policy "Users insert own banner"
  on storage.objects
  for insert
  with check (
    bucket_id = 'profile-banners'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users update own banner"
  on storage.objects
  for update
  using (
    bucket_id = 'profile-banners'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'profile-banners'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own banner"
  on storage.objects
  for delete
  using (
    bucket_id = 'profile-banners'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
