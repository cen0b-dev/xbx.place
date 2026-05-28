# xbx.place

Static Vite + TypeScript frontend for browsing Xbox 360 titles, with download links routed through a proxy endpoint (`/download?key=...`) so raw upstream URLs are not exposed in the UI.

## Requirements

- Node.js 22+
- npm

## Install

```bash
npm ci
```

## Local development

Use the one-command launcher:

```bash
npm run dev:all
```

On macOS you can also double-click `run-dev.command`.

That starts Vite and the Supabase migration watcher. The watcher runs `npx supabase db push` when files under `supabase/migrations` or `supabase/config.toml` change.

Or start Vite alone:

```bash
npm run dev
```

Downloads go through the Cloudflare Worker (`VITE_DOWNLOAD_PROXY_ORIGIN` in `vite.config.ts` by default). No local proxy required.

## Accounts

Supabase powers sign in, registration, and user profiles. Signed-in users can edit their gamertag, gamerpic URL, profile banner URL, and bio from the account menu in the header or from their profile view.

Apply Supabase migrations with:

```bash
npm run supabase:push
```

## Data pipeline

### Build IA filename map

```bash
npm run build:ia-map
```

Creates `public/ia-file-map.json` by scanning the r-roms Xbox 360 page for Redump IA buckets and mapping archive filenames to download URLs.

Credentials are read from env vars (see `.env.example`):

- `IA_COOKIE_POOL` (JSON array: `[{"user":"...","sig":"..."}, ...]`) or
- `IA_COOKIE_POOL_B64` (+ optional `IA_COOKIE_B64_ROUNDS`) or
- fallback `IA_LOGGED_IN_USER` + `IA_LOGGED_IN_SIG`

Optional map flags:

- `IA_MAP_LIMIT_IDENTIFIERS=3`
- `IA_MAP_FILTER_TO_MASTER=1`

### Build site catalog

```bash
npm run build:x360db-catalog
```

Creates `public/master_index.json` from x360db metadata and merges download availability from `public/ia-file-map.json`.

Default behavior is Redump-only visible entries. To include all x360db titles:

```bash
X360DB_REDUMP_ONLY=0 npm run build:x360db-catalog
```

### Full production build

```bash
npm run build
```

This runs `build:data` (`build:x360db-catalog`) before `tsc --noEmit` and `vite build`.

## GitHub Pages deployment

Deployment is handled by `.github/workflows/deploy-github-pages.yml` on push to `main`.

1. In repository settings, set Pages source to **GitHub Actions**.
2. Add Actions variable `VITE_DOWNLOAD_PROXY_ORIGIN` to your production proxy URL (for example, a Cloudflare Worker URL).
3. Push to `main`.

## Proxy options (no paid service required)

GitHub Pages is static and cannot run Node, so production needs an external proxy endpoint if you want to keep raw URLs hidden.

### Option A: Free Cloudflare Worker (recommended for Pages)

Files live in `workers/download-proxy/`.

1. Set `MASTER_INDEX_URL` in `workers/download-proxy/wrangler.toml` to your deployed `master_index.json`.
2. Deploy:

```bash
cd workers/download-proxy
npx wrangler deploy
```

3. Configure secrets/vars in Worker:
   - `IA_COOKIE_POOL` (or `IA_COOKIE_POOL_B64` + `IA_COOKIE_B64_ROUNDS`)
   - optional fallback `IA_LOGGED_IN_USER` + `IA_LOGGED_IN_SIG`
4. Set repo Actions variable `VITE_DOWNLOAD_PROXY_ORIGIN` to the Worker URL and redeploy Pages.

### Option B: Self-hosted Node proxy (optional)

`npm run proxy` remains available if you want to self-host instead of Cloudflare. Set `VITE_DOWNLOAD_PROXY_ORIGIN` to that server origin.

## Notes

- Guest users get one download; signed-in Supabase users get unlimited downloads (see `supabase/README.md`).
- Cookie values are sanitized/canonicalized before building `Cookie` headers.
- IA session cookies (`logged-in-sig`) expire; rotate/reseed your env secrets as needed.
