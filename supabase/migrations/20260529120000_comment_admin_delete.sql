-- Allow site admins (JWT app_metadata.role = 'admin') to delete any comment.
-- Set in Supabase Dashboard → Authentication → Users → user → App Metadata: {"role": "admin"}

drop policy if exists "admins can delete any comment" on public.game_comments;

create policy "admins can delete any comment"
  on public.game_comments for delete to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin');
