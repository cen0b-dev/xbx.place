# xbx.place — Website Overview

Single reference for what xbx.place is, what it contains, how it works, and the workarounds built into the product and data pipeline.

**Live site:** [https://xbx.place/](https://xbx.place/)  
**Stack:** Static Vite + TypeScript SPA, deployed to GitHub Pages. Optional Supabase backend for accounts.

---

## Mission

xbx.place is an **index-style catalog** for Xbox 360 games, title updates, and DLC. It makes preservation archives easier to discover: fast search, cover art, community ratings, regional variants, and direct links to downloadable files.

The site **does not host, proxy, or store game files**. It links out to third-party archives. xbx.place is a discovery layer on top of public metadata and mirrors.

---

## Catalog scale (current build)

Figures from `public/master_index.json` / `data/x360db-index.json` (generated 2026-05-28).

| Metric | Count |
|--------|------:|
| **Catalog titles** (browse entries) | **1,364** |
| Titles with at least one download | 1,364 |
| Titles with game ROMs (Redump zips) | 953 |
| Titles with any DLC and/or title update | 859 |
| Titles with community ratings | 896 |
| **Game download files** (unique) | **2,048** |
| **DLC / add-on packages** (unique) | **3,913** |
| **Title update packages** (unique) | **1,409** |
| Total download links (Archive.org) | 7,420 |
| Fast-path links (MiNERVA, Redump only) | 2,102 |

### How titles are grouped

- **1,243 entries** come from [x360db](https://github.com/xenia-manager/x360db) (full metadata, artwork, ratings).
- **121 entries** are **orphan DLC buckets**: DLC/update packs that could not be matched to a parent game in x360db. They appear as separate catalog rows with placeholder art and a note that the parent game was not matched.

### Data sources

| Source | Role |
|--------|------|
| **x360db** | Title IDs, names, descriptions, developers, publishers, release dates, genres, regions, ratings, box art & backgrounds |
| **Internet Archive** | Redump Xbox 360 zips (`microsoft_xbox360_*` buckets), DLC archives (`XBOX_360_DLC_1` … `_6`), title updates (`microsoft_xbox360_title-updates`) — indexed from the [/r/Roms megathread](https://r-roms.github.io/Microsoft/microsoft-xbox360) |
| **MiNERVA Archive** | Per-file rom pages, magnets, and `.torrent` files for Redump game zips (~29 TB full collection) |

Build pipeline:

```bash
npm run build:ia-map          # Refresh Archive.org file map (requires IA cookie credentials)
npm run build:x360db-catalog  # Merge x360db + ia-file-map + MiNERVA URLs → master_index.json
npm run build                 # Full production build
```

By default, `X360DB_REDUMP_ONLY=1` keeps only titles that have at least one downloadable file in the merged index.

---

## User model and capacity

### Who can use the site

| User type | Browse & search | Download | Collections & profile |
|-----------|-----------------|----------|------------------------|
| **Anonymous visitor** | Yes | Yes — unlimited, direct to Archive / MiNERVA | No |
| **Signed-in account** (Supabase) | Yes | Yes — same as anonymous | Yes |

**There is no in-app limit on how many people can use xbx.place or how many downloads they start.** Downloads never pass through xbx.place servers, so traffic scales with GitHub Pages (static assets) and Supabase (accounts only).

### Account features (optional)

When `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured:

- **Email + password auth** (sign up / sign in / sign out)
- **Profiles:** gamertag (unique), bio, gamerpic, banner
- **Public profile URLs:** `?profile=<gamertag>`
- **Collections:** named lists of games; public or private; add/remove from game detail modal
- **Profile image uploads:** Supabase Storage (`gamerpics` ≤ 512 KB, `profile-banners` ≤ 2 MB)

Account capacity is bounded by the **Supabase project plan** (Free tier: ~50k monthly active users; Pro and above scale further). The frontend ships only the publishable `anon` key — never the service role key.

### Legacy note

A `guest_downloads` table exists in an early migration (one download per anonymous guest via a proxy). **It is unused.** The app serves downloads directly in the browser with no Supabase gating.

---

## Core features

### Browse & discovery

- **Two pivot modes:** **Games** and **Add-ons & DLC** (horizontal pivot in the header).
- **Featured hero row** — top-rated titles with large cover-forward cards.
- **Genre rail** — Action, Shooter, RPG, Racing, Sports, Fighting, Strategy, Family, Platformer, Music, Puzzle (mapped from x360db genre strings).
- **Add-on type rail** (DLC mode) — All Packages, DLC & Add-ons, Title Updates.
- **Infinite scroll grid** — loads tiles in batches (5 rows × column count; 40 items per batch in DLC mode).
- **Scroll-reveal animations** on tiles and shelves.

### Search & filters

- **Fuzzy search** (Fuse.js) across title name, developer, publisher, regions, language tags, and download filenames.
- **Sort:** rating, name, release date (games); name and package count (DLC mode).
- **Region filter:** All, USA, Europe, Japan, World — affects featured picks and catalog results.
- **URL-synced state:** `?genre=`, `?package=`, `?title=`, `?profile=` for shareable views.

### Game detail modal (“blade”)

- Cover art (with top-strip crop — see Workarounds), background art when available, description, developer, publisher, release date, community star rating, genres, regions.
- **Download modal** with tabbed sections when a title has game files, title updates, and DLC together: **Game | Updates | DLC**.
- Title updates sorted newest-first by parsed `(vN)` version strings.
- **Add to collection** (signed-in users): pick existing lists or create new ones; quick-save button.

### Add-on / DLC browse mode

- List-style cards showing package counts (e.g. `3 DLC · 2 updates`).
- Package modal with filtered download list by active add-on type filter.
- Orphan DLC entries browseable like any other title.

### Preferences (local, per device)

Stored in `localStorage`:

- **Accent theme** — Xbox green plus Fluent palette slots (blue, red, purple, yellow).
- **Default region** — filters featured titles and catalog.

### Static pages

- **About** (`about.html`) — mission, data sources, download transparency.
- **DMCA** (`dmca.html`) — rights-holder takedown process.
- **SEO:** sitemap, robots.txt, Open Graph/Twitter meta, `llms.txt` for assistants.

### Visual design

Documented separately in [foundations.md](./foundations.md), [components.md](./components.md), and [motifs-and-interactions.md](./motifs-and-interactions.md). Summary: dark Xbox-inspired UI blending Metro tile grids, Series X|S rounded corners, green accent focus rings, horizontal shelves, and sliding modal “blades.”

---

## How downloading works

xbx.place does **not** buffer whole ROMs on Cloudflare. A Worker **authorizes** the request, uses the **IA cookie pool** (secrets) to resolve the Archive CDN URL, then returns a **stream link** on the Worker (`/download/file`) that pipes bytes from Archive with pool credentials. Non-Archive hosts get a direct mirror URL. The browser’s download UI shows the Worker hostname for Archive files.

### Archive (Internet Archive HTTP)

| | |
|--|--|
| **Button** | Primary download button on each file row |
| **Destination** | Worker `/download/file?key=…` (streams from IA CDN using pool cookies) |
| **Behavior** | App calls Worker → `{ url }` → new tab; Worker resolves CDN with pool, then streams (Range-aware). IA does not issue cookieless expiring CDN URLs. |
| **Speed** | Slower HTTP; reliable for all file types (games, DLC, title updates) |
| **Coverage** | All 7,420 indexed files |

### MiNERVA (fast path — Redump games only)

| | |
|--|--|
| **Button** | Magnet icon beside game rows that have a `fastUrl` |
| **Destination** | [minerva-archive.org](https://minerva-archive.org/) |
| **Behavior** | Client-side lookup in MiNERVA’s `hashes.db` via sql.js-httpvfs, then: **magnet → .torrent file → rom page** (first success wins) |
| **Speed** | BitTorrent; preferred for large Redump zips |
| **Coverage** | ~2,102 game files (not DLC or title-update archives) |

DLC and title updates are **Archive-only** because they live in separate IA buckets, not the MiNERVA Redump tree.

### Download UI details

- Filenames are parsed for display: region, language codes, update version (`v4`, etc.).
- Pop-up blockers show an inline error (“Allow pop-ups for this site”).
- Busy state on buttons while a download starts.

---

## Workarounds and technical constraints

These exist because of browser security, cross-origin limits, messy source filenames, or incomplete metadata — not because of product policy.

### 1. No ROM byte proxy

**Problem:** Proxying multi-gigabyte ROMs through Cloudflare Workers is impractical (bandwidth limits, cost, hosting risk).  
**Workaround:** Worker is an auth gate + URL resolver only (`{ url }` JSON). The browser fetches the file from Archive (or other allowlisted hosts). No ROM bytes pass through Cloudflare.

### 2. Internet Archive cookie pool (server-only)

**Problem:** Archive redirects downloads to CDN hosts that require `logged-in-user` / `logged-in-sig` cookies. Browsers cannot receive those cookies from xbx.place or a Worker JSON response.  
**Workaround:** Operators maintain `IA_COOKIE_POOL` in `.env.local` (for `build:ia-map`) and `wrangler secret put IA_COOKIE_POOL` on the download Worker. The Worker resolves the CDN URL with a random pool account, then **streams** through `/download/file` using that session. Users never paste cookies. This is passthrough streaming, not edge caching of full ROMs.

### 3. MiNERVA per-file magnet lookup

**Problem:** Opening the generic rom page for every download is an extra click and slower UX.  
**Workaround:** Load MiNERVA’s remote SQLite (`hashes.db`) in the browser via **sql.js-httpvfs**, query `files.full_path` for the Redump path, and launch the per-file magnet or torrent. Tracker list is fetched from MiNERVA’s `rom.js` with a static fallback baked into `minerva-constants.ts`.

### 4. DLC → parent game matching

**Problem:** DLC zip names do not always match x360db title strings.  
**Workaround (build script):**

- Normalize filenames (strip regions, extensions, `(Addon)` / `(Update)` suffixes).
- Fuzzy prefix matching against catalog names.
- **Title aliases** (e.g. “Call of Duty 7” → “Call of Duty Black Ops”).
- **“The” handling** — `foo the` ↔ `the foo`.
- Unmatched packs become **orphan catalog entries** (`metadata.source: "ia-dlc"`) instead of being dropped.

### 5. Box art top-strip crop

**Problem:** x360db box art includes a green Xbox 360 banner strip at the top that clashes with the tile layout.  
**Workaround:** Client-side canvas crop (`cover-crop.ts`) removes ~48 px (scaled to image width) from the top of covers; results cached as blob URLs. Falls back to raw art if CORS or rasterization fails.

### 6. Duplicate title names in index

**Problem:** Rare duplicate names in merged data.  
**Workaround:** `loadTitles()` dedupes by normalized name, keeping the entry with higher rating (+ slight boost if developer metadata exists).

### 7. Synthetic title IDs for orphans

**Problem:** Orphan DLC buckets have no x360db `title_id`.  
**Workaround:** Build generates deterministic synthetic IDs; placeholder cover (`placehold.co`) when ID is not a valid 8-hex x360db id.

### 8. Supabase optional degradation

**Problem:** Site must work on GitHub Pages without backend env vars.  
**Workaround:** Auth UI hidden when Supabase is not configured; catalog and downloads work fully anonymous.

### 9. Build-time IA authentication

**Problem:** Archive.org metadata API requires authenticated cookies to enumerate large buckets.  
**Workaround:** `build:ia-map.mjs` reads `IA_COOKIE_POOL` (JSON or base64-multi-round encoded `IA_COOKIE_POOL_B64`) and rotates pairs per request. Sources identifiers from the r-roms megathread markdown.

### 10. REDUMP-only catalog filter

**Problem:** Full x360db lists thousands of titles with no public ROM mirror.  
**Workaround:** Default build (`REDUMP_ONLY=1`) exports only titles with ≥1 download link, keeping the live catalog focused on actually obtainable files.

---

## Architecture summary

```
┌─────────────────────────────────────────────────────────────┐
│  xbx.place (static SPA on GitHub Pages)                     │
│  • master_index.json  • Fuse search  • Vite bundle           │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│  Supabase (optional)      │    │  Third-party file hosts     │
│  • Auth                   │    │  • archive.org/download/…   │
│  • profiles               │    │  • minerva-archive.org      │
│  • collections            │    │    (magnet / torrent / HTTP) │
│  • storage (pics/banners) │    └────────────────────────────┘
└──────────────────────────┘
               ▲
               │ metadata + artwork (read-only)
┌──────────────┴──────────────────────────────────────────────┐
│  x360db (GitHub) — games.json, titles/{id}/info.json, art   │
└─────────────────────────────────────────────────────────────┘
```

---

## Related docs

| Document | Contents |
|----------|----------|
| [README.md](../README.md) | Install, dev commands, download & IA cookie quick reference |
| [design/README.md](./README.md) | Design system index |
| [supabase/README.md](../supabase/README.md) | Backend setup and migrations |

---

*Update this file when catalog counts change (`npm run build:x360db-catalog`), download behavior changes, or major features ship.*
