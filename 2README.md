# xbx.place

Static Vite + TypeScript catalog for Xbox 360 titles (x360db metadata). Each file offers **Archive** (Internet Archive HTTP) and **MiNERVA** (torrent/magnet on [minerva-archive.org](https://minerva-archive.org/)).

## Downloads (no ROM byte proxy)

| Button | Host | Notes |
|--------|------|--------|
| **Archive** | Worker stream URL | Worker resolves IA CDN with `IA_COOKIE_POOL`, then pipes the file via `/download/file` (no user cookies). |
| **MiNERVA** | `minerva-archive.org/rom/…` | Fast path: use **Magnet** or **Torrent** on that page. |

xbx.place does **not** stream ROM bytes through Cloudflare Workers.

### Internet Archive cookies (server-only)

Logged-in IA accounts are configured in **`.env.local`** (`IA_COOKIE_POOL` or `IA_LOGGED_IN_USER` / `IA_LOGGED_IN_SIG`) for `npm run build:ia-map` and optional Worker secrets (`wrangler secret put IA_COOKIE_POOL`). Users never paste or apply cookies in the app.

## Data pipeline

```bash
# Requires IA_COOKIE_POOL or IA_LOGGED_IN_USER/SIG in .env.local — refreshes public/ia-file-map.json
# Includes Redump A–Z buckets, XBOX_360_DLC_1 … XBOX_360_DLC_6, and microsoft_xbox360_title-updates from the /r/Roms megathread.
npm run build:ia-map

# Merge x360db + ia-file-map + MiNERVA rom URLs → public/master_index.json
# DLC zips are matched to parent games by name; unmatched packs become separate catalog entries (placeholder art).
npm run build:x360db-catalog

npm run build
```

`build:data` runs the catalog step only (keeps the committed `ia-file-map.json` unless you run `build:ia-map`).

## Install & dev

```bash
npm ci
npm run dev
```
