# Supabase for xbx.place

Supabase powers **user accounts** and **guest download limits** for xbx.place.

## What it does

| User type | Download limit | Enforcement |
|-----------|----------------|-------------|
| Guest (not signed in) | **1 file total** | `guest_downloads` table + localStorage hint |
| Signed-in user | Unlimited | Valid JWT on download proxy |

When a guest tries a second download, the app opens the **Account Required** blade modal (Metro/Xbox design) with sign-in and sign-up tabs.

Signed-in users also get a `profiles` row where they can set a gamertag, gamerpic URL, profile banner URL, and short bio. They can create **collections** of games (public or private) and share their profile at `?profile={gamertag}`.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a project.
2. Under **Project Settings → API**, copy:
   - Project URL → `VITE_SUPABASE_URL` / `SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (**proxy/Worker only**)

### 2. Apply the migration

Using the Supabase CLI (linked to your project):

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

**Mac shortcut:** double-click `Push Supabase.command` in the repo root, or run:

```bash
npm run supabase:deploy
```

That script checks the CLI, confirms the project is linked, and runs `supabase db push` for all files in `supabase/migrations/`.

Or paste **both** migration files into the SQL editor in the dashboard (in order):

1. `supabase/migrations/20260527120000_guest_downloads.sql`
2. `supabase/migrations/20260527133000_profiles.sql`
3. `supabase/migrations/20260527150000_profile_storage.sql`
4. `supabase/migrations/20260527160000_collections.sql`

The migrations create:

- `public.guest_downloads` with RLS enabled and **no public policies** — only the service role (proxy) can read/write.
- `public.profiles` with RLS policies so users can view and update only their own profile.
- `public.public_profiles` view for gamertag-based profile pages without exposing email.
- `public.collections` and `public.collection_items` for user game lists (public or private).
- `storage` buckets `gamerpics` and `profile-banners` for profile image uploads (512 KB / 2 MB limits enforced server-side and in the client).

### 3. Configure Auth

In **Authentication → Providers → Email**:

- Enable email provider
- Disable **Confirm email** if you want users signed in immediately after creating an account (matches `supabase/config.toml`)
- If **Confirm email** stays enabled, users must receive and open the confirmation link before Supabase will allow password sign-in

Add your site URLs under **Authentication → URL Configuration**:

- Site URL: `https://YOUR_USER.github.io/xbx.place/` (or `http://localhost:5173/xbx.place/` for dev)
- Redirect URLs: same + local dev origin

### 4. Environment variables

**Frontend** (`.env.local` or GitHub Actions variables):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Local proxy** (`.env.local`, same file as IA cookies):

```bash
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

**Cloudflare Worker** (secrets):

```bash
cd workers/download-proxy
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

### 5. GitHub Pages build

Add repository **Actions variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DOWNLOAD_PROXY_ORIGIN` (existing Worker URL)

Update `.github/workflows/deploy-github-pages.yml` if you want these passed at build time (same pattern as `VITE_DOWNLOAD_PROXY_ORIGIN`).

## How downloads work

1. User clicks a download row in the title blade.
2. Frontend calls `fetch(proxyUrl, { headers })`:
   - Signed in → `Authorization: Bearer <access_token>`
   - Guest → `X-Guest-Id: <uuid>` (stored in `localStorage`)
3. Proxy verifies JWT **or** checks/inserts `guest_downloads`.
4. On success, the file streams to the browser via blob download.
5. On `403 guest_limit`, the auth modal opens.

If Supabase is **not** configured, the Sign In control stays hidden and the proxy skips server-side guest checks (localStorage gate still applies in the UI).

## Local development

```bash
# Terminal 1
npm run proxy

# Terminal 2
npm run dev
```

Ensure `.env.local` has Supabase keys for full end-to-end testing.

## Security notes

- Never commit or ship `SUPABASE_SERVICE_ROLE_KEY` in the Vite bundle.
- Guest limits without server enforcement can be bypassed — always configure the proxy/Worker in production.
- RLS on `guest_downloads` blocks direct client access; proxy uses service role.
