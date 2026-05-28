# Supabase for xbx.place

Supabase powers **user accounts**, **profiles**, and **collections**. Downloads are served directly from the Wayback Machine in the browser; they are not gated by Supabase.

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a project.
2. Under **Project Settings → API**, copy:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`

### 2. Apply migrations

Using the Supabase CLI (linked to your project):

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

**Mac shortcut:** double-click `Push Supabase.command` in the repo root, or run:

```bash
npm run supabase:deploy
```

Or paste migration files into the SQL editor in the dashboard (in order):

1. `supabase/migrations/20260527120000_guest_downloads.sql` (legacy table; unused by the app)
2. `supabase/migrations/20260527133000_profiles.sql`
3. `supabase/migrations/20260527150000_profile_storage.sql`
4. `supabase/migrations/20260527160000_collections.sql`

### 3. Configure Auth

In **Authentication → Providers → Email**:

- Enable email provider
- Disable **Confirm email** if you want users signed in immediately after creating an account (matches `supabase/config.toml`)

Add your site URLs under **Authentication → URL Configuration**:

- Site URL: `https://YOUR_USER.github.io/xbx.place/` (or `http://localhost:5173/` for dev)
- Redirect URLs: same + local dev origin

### 4. Environment variables

**Frontend** (`.env.local` or GitHub Actions variables):

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 5. GitHub Pages build

Add repository **Actions variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Local development

```bash
npm run dev
```

Ensure `.env.local` has Supabase keys if you are testing sign-in and profiles.

## Security notes

- Never commit or ship `service_role` keys in the Vite bundle.
- Only publishable `anon` keys belong in `VITE_*` variables.
