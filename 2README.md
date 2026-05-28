# xbx.place

Static Vite + TypeScript catalog for Xbox 360 titles (x360db metadata). Each file offers **Archive** (Internet Archive HTTP) and **MiNERVA** (torrent/magnet on [minerva-archive.org](https://minerva-archive.org/)).

## Downloads (no ROM byte proxy)

| Button | Host | Notes |
|--------|------|--------|
| **Archive** | `archive.org/download/…` | Optional Cloudflare Worker checks auth, returns the URL; browser downloads directly from Archive. |
| **MiNERVA** | `minerva-archive.org/rom/…` | Fast path: use **Magnet** or **Torrent** on that page. |

xbx.place does **not** stream ROM bytes through Cloudflare Workers.

### Internet Archive cookies

Browsers cannot send custom `Cookie` headers to Archive from xbx.place (forbidden + cross-origin). To use logged-in IA accounts:

1. **Preferences** → paste `IA_COOKIE_POOL` JSON (`logged-in-user` + `logged-in-sig` from DevTools on archive.org).
2. Save, then use **Apply IA login (bookmarklet)** while on [archive.org](https://archive.org/) (drag to bookmarks bar or click once).
3. Return to xbx.place and click **Archive** — the browser sends those cookies on `archive.org`.

Optional: set `VITE_IA_COOKIE_POOL` in `.env.local` as a default pool for local dev.

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
