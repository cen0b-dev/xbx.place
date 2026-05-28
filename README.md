# xbx.place

Static Vite + TypeScript frontend for browsing Xbox 360 titles. Download buttons stream files from Internet Archive URLs in the catalog without exposing raw links in the page markup (no `href` on download controls).

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
2. Add Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you use accounts.
3. Push to `main`.

## Downloads

Clicking a download row starts the file from the catalog’s archive.org URL in a hidden iframe. Buttons are plain `<button>` elements (no link URL in the DOM), so hovering does not reveal the Internet Archive address in the status bar.

Xbox marketplace screenshots in the catalog are `http://download.xbox.com/…` only; the app rewrites them to load over HTTPS via `images.weserv.nl` so they work on GitHub Pages.
