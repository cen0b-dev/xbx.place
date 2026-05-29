-- Address Supabase Security Advisor warnings (functions, storage listing, EXECUTE grants).

-- 1. set_updated_at: pin search_path to prevent search_path hijacking.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. Public buckets: drop broad SELECT policies that allow API listing.
--    Buckets stay public=true, so direct object URLs still work without these policies.
drop policy if exists "Public read gamerpics" on storage.objects;
drop policy if exists "Public read profile banners" on storage.objects;

-- 3. Trigger-only SECURITY DEFINER: revoke direct EXECUTE from API roles.
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.create_profile_for_new_user() from anon;
revoke all on function public.create_profile_for_new_user() from authenticated;

-- 4. Service-role-only RPC: tighten EXECUTE grants (anon/authenticated inherit from public).
revoke all on function public.record_ia_cookie_use(uuid, text) from public;
revoke all on function public.record_ia_cookie_use(uuid, text) from anon;
revoke all on function public.record_ia_cookie_use(uuid, text) from authenticated;
grant execute on function public.record_ia_cookie_use(uuid, text) to service_role;
