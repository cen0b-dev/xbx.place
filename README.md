# xbx.place

Static Vite + TypeScript catalog for Xbox 360 titles (x360db metadata). Each file offers **Archive** (Internet Archive HTTP) and **MiNERVA** (torrent/magnet on [minerva-archive.org](https://minerva-archive.org/)).

## Downloads (no proxy)

| Button | Host | Notes |
|--------|------|--------|
| **Archive** | `archive.org/download/…` | Opens in a new tab. Slower but direct HTTP. |
| **MiNERVA** | `minerva-archive.org/rom/…` | Fast path: use **Magnet** or **Torrent** on that page. |

xbx.place does **not** proxy file bytes through Cloudflare or any worker.

### Internet Archive cookies

Browsers cannot send custom `Cookie` headers to Archive from xbx.place (forbidden + cross-origin). To use logged-in IA accounts:

1. **Preferences** → paste `IA_COOKIE_POOL` JSON (`logged-in-user` + `logged-in-sig` from DevTools on archive.org).
2. Save, then use **Apply IA login (bookmarklet)** while on [archive.org](https://archive.org/) (drag to bookmarks bar or click once).
3. Return to xbx.place and click **Archive** — the browser sends those cookies on `archive.org`.

Optional: set `VITE_IA_COOKIE_POOL` in `.env.local` as a default pool for local dev.

## Data pipeline

```bash
# Requires IA_COOKIE_POOL or IA_LOGGED_IN_USER/SIG in .env.local — refreshes public/ia-file-map.json
npm run build:ia-map

# Merge x360db + ia-file-map + MiNERVA rom URLs → public/master_index.json
npm run build:x360db-catalog

npm run build
```

`build:data` runs the catalog step only (keeps the committed `ia-file-map.json` unless you run `build:ia-map`).

## Install & dev

```bash
npm ci
npm run dev
```
