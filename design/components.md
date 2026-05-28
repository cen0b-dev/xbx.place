# Components

Component specs for xbx.place. Class names match `src/styles.css` and markup in `src/main.ts` / `src/auth-ui.ts`.

---

## App shell

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER (sticky)                                              │
│  top-bar: logo + account (profile mode)                       │
│  profile-back-link (profile / game views)                     │
│  nav-row: pivots · search · sign-in / avatar menu             │
├──────────────────────────────────────────────────────────────┤
│  #browsePage (.browse-page-shell, max 1600px)                 │
│    site-hero → featured row → genre/package rail → catalog    │
├──────────────────────────────────────────────────────────────┤
│  #gamePage (body.game-view)                                   │
│  #profilePage (body.profile-view)                             │
├──────────────────────────────────────────────────────────────┤
│  FOOTER (hidden in game-view)                                 │
└──────────────────────────────────────────────────────────────┘
  Overlays: #setMod · #authMod · #accountSettingsMod ·
            #downloadMod · #packageMod · #collectionMod · #mediaLightbox
  #btt — back to top FAB
```

| Body class | Visible main surface |
|------------|---------------------|
| *(none)* | Browse, games pivot |
| `browse-mode-dlc` | Browse, add-ons pivot (list cards) |
| `game-view` | `#gamePage` |
| `profile-view` | `#profilePage` |

---

## Header (`.header`)

**Role:** Persistent Xbox-style hub chrome.

| Part | Classes | Behavior |
|------|---------|----------|
| Sticky bar | `.header` | `z-index: 2500`, frosted `#101010f2`, bottom border |
| Brand | `.brand` + logo | `xbx.` + accent `place`; click → home / close views |
| Top account | `#header-account-fallback` | Avatar slot when not in browse nav row |
| Back | `.profile-back-link` | Shown in `game-view` / `profile-view` |
| Pivots | `.pivot` | `GAMES` / `ADDONS & DLC`; active = white + 4px `--green` underline |
| Search | `#q.inp` in `.nav-search` | Fuse.js filter; placeholder shows catalog count |
| Account | `.account-trigger` | Guest: icon + "Sign In"; signed-in: circular gamerpic pill |
| Account menu | `.account-menu` | Dropdown: profile, preferences, sign out (shares drawer chrome) |

Browse-only rows use `.browse-only` (hidden in game/profile views).

---

## Site hero (`.site-hero`)

**Role:** Marketing banner above the catalog.

| Part | Notes |
|------|-------|
| Container | Left green tint gradient, `--r-lg`, `--shadow-panel` |
| Background | `.site-hero-slides` — crossfading cover art (`heroCrossfade`, 20s) |
| Copy | Eyebrow, title (accent span), lead, stat pills, "Browse catalog" CTA |
| Stats | `#siteHeroGames` / `#siteHeroAddons` — live counts; emphasis toggles in DLC mode |
| Visual | `.site-hero-covers` — three floating cropped covers with `heroCoverFloat` |
| DLC mode | Copy/eyebrow/stats swap via `updateBrowseModeChrome()` |

No compact/collapse mode in current build — hero is always full height (responsive single column ≤ 900px).

---

## Browse sections

Shared section chrome:

- `.browse-section-head` — flex row with bottom rule
- `.game-section-title` — uppercase section label
- `.browse-section-sub` — muted subtitle under title
- `.browse-section--rail` — `--surface-rail` panel with border + `--r-lg`

### Featured row (`.browse-hero-grid`)

| Property | Value |
|----------|-------|
| Layout | 3-column grid desktop; horizontal snap carousel ≤ 900px |
| Card | `.browse-hero-card` — `<button>`, min-height 220px, `#1c1c1c` |
| Art | `.browse-hero-bg` full bleed; `.browse-hero-shade` dual gradient |
| Rank pill | `.browse-hero-rank` top-left |
| Factory | `createHeroCard()` in `src/browse-card.ts` |

Games mode: top-rated by community score. DLC mode: titles with add-on packages.

### Genre rail (`.genre-grid--rail`)

Horizontal scroll row of `.genre-chip` buttons:

| State | Visual |
|-------|--------|
| Default | `--surface-raised`, `--r-md`, icon + label |
| Hover | Lighter border, subtle shadow |
| `.is-active` | `--selected-bg`, green border + inset ring |

Syncs to `?genre=`. On mobile, genre section **orders above** featured (`order: -1`).

### Package type rail (DLC only)

Same chip pattern as genres; filters `?package=` (`all` | `dlc` | `update`). Hidden unless `body.browse-mode-dlc`.

### Catalog section (`.browse-section--catalog`)

| Part | Role |
|------|------|
| Title | `#lTitle` — "All Games" / add-on variant |
| Score tooltip | `.browse-score-info` — explains 0–100 community score |
| Count | `#cnt` — filtered total |
| Filter trigger | `.browse-filter-trigger` — opens drawer; badge shows active filter count |
| Filter bar | `#browseFilterBar` — removable chips (genre, region, search) |
| Grid | `#grid` — infinite scroll tiles |
| Sentinel | `#gridSentinel` — IntersectionObserver load-more |
| Status | `#pager` — **"Showing N of M"** text only (not page buttons) |

---

## Filter drawer (`.browse-filter-drawer`)

**Role:** Sort + region controls (moved out of header toolbar).

| Part | Behavior |
|------|----------|
| Host | `.browse-filter-drawer-host` — relative anchor in catalog header |
| Panel | Absolute dropdown, `min(380px, 100vw - 36px)`, `--shadow-panel` |
| Fields | `#sort` dropdown, `#browseReg` region (synced with Preferences `#reg`) |
| Reset | `#browseFilterReset` — clears sort/region to defaults |
| Active state | Trigger gets `.is-active` + green ring when filters differ from default |

Account menu reuses drawer head/close classes for visual consistency.

---

## Game grid (`.browse-grid` / `.browse-card`)

**Role:** Primary games catalog — portrait cover tiles.

```
┌─────────────┐
│ cover-crop  │  ← aspect-ratio from --t-w / --cover-visible-h
│   (image)   │
│  ::after    │  ← bottom gradient scrim
│  overlay    │  ← title, stars, score badge
│  hover layer│  ← title, meta, "View" CTA (on hover)
└─────────────┘
```

| State | Visual |
|-------|--------|
| Default | `--tile`, 2px transparent border |
| Hover / focus | `scale(1.02)`, green border, overlay swaps to hover panel |
| `.browse-card--dim` | Grayscale + 45% opacity (no downloads) |
| `.is-loading` | Shimmer pseudo until cover loads |
| Badge | `.browse-card-addon-badge` — "+ Addons" when DLC present |

Factory: `createGridCard()` in `src/browse-card.ts`. Batch-loaded via infinite scroll (`ROWS_PER_BATCH` × column count; 40 items per batch in DLC mode).

---

## Add-on list (`.browse-grid--addons` / `.addon-list-card`)

**Role:** DLC pivot catalog — horizontal list rows, max-width `--addon-list-max`.

| Part | Notes |
|------|-------|
| Layout | Flex column, centered 960px |
| Card | `.addon-list-card` — row: cropped thumb, title, package summary, chevron CTA |
| Click | Opens `#packageMod` (not inline shelf) |
| `.addon-list-card--dim` | No downloadable packages |
| Factory | `createAddonListCard()` |

No scale transform on hover — border/background emphasis only.

---

## Game detail page (`#gamePage` / `.game-page`)

**Role:** Full-page title view (`body.game-view`). URL: `?title=`.

```
.game-page
├── .game-page-bg (fixed cover + shade + bottom fade)
└── .game-page-shell
    ├── .game-back-link
    └── .game-page-stage
        ├── .game-page-skeleton (shimmer layout)
        └── .game-page-content
            └── .game-page-layout (240px sidebar | main)
                ├── sidebar: cover, Download, collection split, More options
                └── main: title, score, stars, tags, desc, meta grid,
                          Media carousel, More like this carousel
```

| Part | Notes |
|------|-------|
| Loading | `.game-page--loading` → skeleton; `.game-page--ready` fades content in |
| Cover | `.game-page-cover-wrap.cover-crop-view` + sticky sidebar |
| Score | `.game-page-score-badge` — same tier colors as tiles |
| Meta | 4-column grid: Developer, Publisher, Release, Regions |
| Carousels | `.game-scroll-wrap` with circular prev/next + edge fade masks |
| Media lightbox | `#mediaLightbox` full-screen image viewer |

**Actions:**

- **Download** → `#downloadMod`
- **Add to collection** / quick **+** → `#collectionMod` (auth required)
- **More options** → opens download modal or context actions

---

## Overlay modals (`.overlay` / `.game-modal`)

Shared pattern for settings, auth, downloads, collections.

| Variant | Classes | Use |
|---------|---------|-----|
| Full-bleed scroll | `.overlay` | Preferences `#setMod`, auth, collection |
| Centered sheet | `.overlay.overlay--fit` | Download, package, account settings |
| Ambient bg | `.game-modal--ambient` | Auth (no cover art; green gradient) |
| Cover wash | `.game-modal-bg-img` + shade | Download, collection, package |

Shell structure:

```
.game-modal-page-shell
├── .game-back-link
└── .game-modal-body--narrow (760px) | --wide (980px)
    ├── .game-modal-header (eyebrow, title, sub)
    ├── .game-modal-section
    │   └── .game-modal-panel (frosted bordered scroll area)
    └── .game-modal-footer
```

Download/package modals use flex column + scrollable panel (`#downloadMod`, `#packageMod`).

---

## Download picker (`#downloadMod`)

| Part | Behavior |
|------|----------|
| List | `.dl-btn-row` per file: primary `.dl-btn` + optional `.dl-btn-side--torrent` (magnet) |
| Tabs | When game + updates + DLC coexist: **Game | Updates | DLC** (`.tabs`) |
| Display | `formatDownloadDisplay()` — parsed region, languages, version in `.dl-meta` |
| Notice | `.download-notice` fixed bottom toast (success green / error red) |
| Busy | `.busy` disables button + pulse animation |

Updates sorted newest-first via `orderPackageDownloads()`.

---

## Package picker (`#packageMod`)

Same shell as download modal; used from add-on list cards. Copy varies by `activeAddonType` (DLC vs title updates). Lists filtered packages only.

---

## Collection modal (`#collectionMod`)

| View | ID | Purpose |
|------|-----|---------|
| Pick | `#collection-mod-pick-view` | Checkbox list of user collections |
| Create | `#collection-mod-create-view` | Name + public toggle |
| Empty | `#collection-mod-empty-view` | First-collection onboarding |

Components: `.collection-mod-row`, `.collection-mod-badge` (public/private), split footer with New + Save.

---

## Preferences (`#setMod`)

Device-local settings (not account):

| Option | Storage |
|--------|---------|
| Theme accent | `.swatches` / `.swatch` → `x_th` |
| Default region | `#reg` dropdown → `x_r` |

Opened from account menu → Preferences. Region syncs with catalog filter drawer `#browseReg`.

---

## Auth (`#authMod`)

Centered `.game-modal--ambient` with sign-in / sign-up pivots (`.auth-pivot`), email/password fields, perks list, `#auth-error` banner. Submit via `#auth-submit`.

Legacy `.auth-blade` CSS remains in stylesheet but **is not used** in current markup.

---

## Account settings (`#accountSettingsMod`)

`.overlay--fit` wide layout:

- Sidebar card: avatar, name, email
- Form: gamertag, bio, gamerpic/banner upload, metro row fields
- Uses `#accountSettingsMod` scoped compact spacing

Opened from profile hub **Edit Profile** or account menu.

---

## Profile hub (`#profilePage`)

**Role:** Public/private profile at `?profile=<gamertag>` (`body.profile-view`).

```
.profile-hub
├── .profile-hub-banner (upload or accent fallback mesh)
└── .profile-hub-shell
    ├── .profile-identity-card (avatar overlaps banner, name, bio, actions)
    ├── Account tiles (owner only)
    ├── Collections grid (public visible to visitors)
    └── Edit form (owner, toggled hidden)
```

| Component | Notes |
|-----------|-------|
| `.hub-tile` | Edit profile, copy link |
| `.profile-collection-card` | Public/private badge, game thumbnails grid |
| `.profile-collection-game` | Opens game page on click |
| Not found | `#profile-not-found` for bad gamertag |

---

## Account menu (`.account-menu`)

Dropdown from avatar trigger:

- Profile summary (avatar, gamertag, email)
- Open profile page
- Preferences → `#setMod`
- Sign out (red hover)

Shares `.browse-filter-drawer-*` head/close styling.

---

## Form controls

| Component | Classes |
|-----------|---------|
| Text input | `.inp` — 2px border, green focus |
| Textarea | `.settings-text-input--area` — monospace for JSON |
| Dropdown | `.ui-dropdown` + `--compact` / `--block`; custom menu with checkmark on selected |
| Checkbox | `.ui-check` — green fill when checked |
| Primary button | `.btn` — `--green` fill |
| Ghost button | `.btn-ghost` — raised surface, green border on hover |

Sort options: rating, name, release date (games); name / package count (DLC).

---

## Footer (`.footer`)

Top border, logo + links (About, DMCA). Muted `#666` body; link hover → `--green`. Hidden in `game-view`.

---

## Back to top (`#btt`)

Fixed bottom-right: dark `#1c1c1c` tile, green arrow icon, `12px` radius. `.show` after scroll threshold. Hidden in game/profile views.

---

## Legacy / unused in markup

These classes remain in `src/styles.css` but are **not wired** to current UI:

| Class | Was intended for |
|-------|------------------|
| `.blade`, `.blade.sm`, `.blade.lg` | Old centered blade modals |
| `.browse-shelf` | Inline expand panel below grid |
| `#dimmer`, `body.dimmed` | Page dim behind shelf focus |
| `.m-l`, `.m-r`, `.m-head` | Old blade interior layout |

Do not extend these without rewiring or removing dead CSS.

---

## Static pages

`public/about.html` and `public/dmca.html` — minimal 860px prose column, `#101010` background, Inter font. Outside the app shell.
