-- Sanitize profile text fields and restrict image URLs to Supabase storage uploads.

update public.profiles
set gamerpic_url = null
where gamerpic_url is not null
  and gamerpic_url !~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/gamerpics/[0-9a-f-]{36}/avatar\.webp(\?.*)?$';

update public.profiles
set banner_url = null
where banner_url is not null
  and banner_url !~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/profile-banners/[0-9a-f-]{36}/banner\.webp(\?.*)?$';

update public.profiles
set gamertag = left(regexp_replace(trim(gamertag), '[^\w -]', '', 'g'), 32)
where gamertag !~ '^[\w][\w -]{0,30}[\w]$'
  and gamertag !~ '^[\w]$';

update public.profiles
set gamertag = 'New Player'
where char_length(trim(gamertag)) = 0;

update public.profiles
set bio = left(bio, 180)
where bio is not null
  and char_length(bio) > 180;

alter table public.profiles
  add constraint profiles_gamertag_len
  check (char_length(trim(gamertag)) between 1 and 32);

alter table public.profiles
  add constraint profiles_gamertag_chars
  check (gamertag ~ '^[\w][\w -]{0,30}[\w]$' or gamertag ~ '^[\w]$');

alter table public.profiles
  add constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 180);

alter table public.profiles
  add constraint profiles_gamerpic_url_upload_only
  check (
    gamerpic_url is null
    or gamerpic_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/gamerpics/[0-9a-f-]{36}/avatar\.webp(\?.*)?$'
  );

alter table public.profiles
  add constraint profiles_banner_url_upload_only
  check (
    banner_url is null
    or banner_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/profile-banners/[0-9a-f-]{36}/banner\.webp(\?.*)?$'
  );
