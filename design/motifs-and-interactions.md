# Motifs & Interactions

Visual motifs, behavioral patterns, and interaction vocabulary across xbx.place.

---

## Core motifs (visual DNA)

### 1. Cover-forward tiles

The **Xbox 360 box shot** is the atomic UI unit — grid tiles, hero cards, game page sidebar, profile collection thumbs, and site-hero fan all use the same crop ratio.

Covers load through `cover-crop.ts` when possible; otherwise CSS top-strip offset. Aspect ratio always derives from `--t-w` / `--cover-visible-h`.

### 2. Green focus ring

Selection = **2px `--green` border** (not glow halos). Used on:

- Grid tiles and hero cards (`:focus-visible` parity)
- Genre / package chips when active
- Filter trigger when open or filters active
- Download rows (left 4px accent on hover)
- Scroll carousel nav hover

### 3. Dual-state tile overlay

At rest, tiles show **persistent bottom scrim** with title, stars, and community score badge. On hover/focus, default meta **fades out** and a **hover panel** appears with extended meta + green "View" pill — more information without leaving the grid.

### 4. Uppercase structural type

Wayfinding labels shout in caps:

- Pivots: `GAMES`, `ADDONS & DLC`
- Sections: `TOP RATED`, `BROWSE BY GENRE`, `ALL GAMES`, `MEDIA`
- Field labels: `DEVELOPER`, `SORT CATALOG`, `REGION`
- Modal eyebrows: `DOWNLOAD`, `SITE`, `COLLECTION`

Body copy and parsed download titles stay sentence case.

### 5. Dark stack layers

Depth progresses **#101010 → #202020 → #252525 → #1f1f1f** — never pure black except modal scrims. Keeps green accent and cover art readable on OLED-style backgrounds.

### 6. Gradient scrims on imagery

Mandatory wherever text meets photos:

- `.browse-card.is-loaded::after` — multi-stop bottom gradient
- `.browse-hero-shade`, `.game-page-bg-shade`
- Modal `.game-modal-bg-shade`
- Hero copy text-shadow on featured titles

### 7. Pill micro-elements

Stats (`.site-hero-stat`), filter chips, rank badges, avatars, scroll dots — full rounding (`--r-pill`). Primary "Series softened Metro" break from sharp 2012 tiles.

### 8. Community score as Metacritic-style badge

0–100 integer on tiles and game page with tier color coding (exceptional → muted). Unrated shows **NR** in neutral gray — distinct from low scores.

---

## Navigation & view flows

### Pivot switch (Games ↔ Add-ons)

```
[ GAMES ]──────  ADDONS & DLC
   ↑ 4px green underline
```

- Instant re-filter; no full reload
- `body.browse-mode-dlc` toggles hero copy, featured source, grid layout (portrait tiles → list rows), genre rail → package type rail
- URL does not require a pivot param — state is in-memory unless genre/package filters set

### Browse → game detail

1. Click grid tile or hero card → `body.game-view`, `#gamePage` visible
2. URL `?title=<title_id>` for deep linking
3. Skeleton → content fade-in when cover/metadata ready
4. Back link or browser history → returns to browse (scroll position preserved where possible)
5. Footer and FAB hidden

### Browse → package picker (DLC mode)

1. Click `.addon-list-card` → `#packageMod` overlay (not inline shelf)
2. Select file → same download row pattern as game modal
3. Back closes modal; browse grid remains underneath

### Search & filters

| Input | Effect |
|-------|--------|
| `#q` search | Fuse.js across name, dev, publisher, regions, filenames |
| Genre chip | `?genre=` + chip in filter bar |
| Package chip | `?package=` (DLC mode) |
| Filter drawer region | Filters featured + catalog; syncs Preferences |
| Filter drawer sort | Re-orders grid; resets infinite scroll |
| Filter bar chips | Per-filter dismiss + clear all |

Changing category or filters resets `loadedCount`, clears grid, re-observes sentinel.

### Infinite scroll

- `#gridSentinel` + `IntersectionObserver` with `400px` root margin
- Batch size: `5 rows × column count` (games) or `40` (DLC list)
- `#pager` shows **"Showing N of M"** — not numbered pagination
- `.browse-grid.is-transitioning` brief fade when filter set changes

### Account flows

| Action | Result |
|--------|--------|
| Sign In (guest trigger) | `#authMod` overlay |
| Signed-in avatar | `.account-menu` dropdown |
| Profile page | `body.profile-view`, `?profile=` |
| Edit profile | `#accountSettingsMod` |
| Preferences | `#setMod` (local theme/region/IA cookies) |
| Add to collection | `#collectionMod` from game page |

Downloads do **not** require sign-in.

---

## Scroll reveal

`.reveal` + `IntersectionObserver` in `src/reveal.ts`:

- Stagger via `--reveal-delay` (typically 35ms × index)
- Applied to hero cards, genre chips, grid tiles (first row eager on initial load)
- Disabled under `prefers-reduced-motion: reduce` — elements render immediately

---

## Hover = preview, click = commit

| Element | Hover | Click |
|---------|-------|-------|
| Grid tile | Scale + border; hover overlay | Open game page |
| Hero card | Lift + bg zoom | Open game page |
| Addon list row | Border + chevron reveal | Open package modal |
| Genre chip | Border brighten | Toggle filter |
| Rec/media card | Border + slight lift | Navigate / lightbox |

`prefers-reduced-motion: reduce` suppresses tile scale and hero motion.

---

## Z-index model

| Layer | z-index | Purpose |
|-------|---------|---------|
| Game page bg | 0 | Fixed ambient art |
| `#dimmer` (legacy) | 1000 | Unused in current flows |
| Elevated tile hover | 1002 | Above siblings |
| Filter tooltip | 100 | Score info tip |
| `#btt` | 2000 | Back to top |
| `.header` | 2500 | Sticky chrome |
| `.overlay` | 3000 | Modals |
| Filter drawer / dropdown open | 3500–4000 | Above header when open |
| `.download-notice` | 5000 | Toast |

Rule: **toast > overlay > header > FAB > tiles**.

---

## Download interaction

1. User picks file in `#downloadMod` or `#packageMod`
2. **Archive** → `window.open` to Internet Archive (pop-up blocker surfaces error notice)
3. **Magnet** (Redump games only) → async MiNERVA hash lookup → magnet / torrent / rom page fallback
4. `.download-notice` toast confirms start or reports error
5. Button `.busy` state during async torrent path

Row hover: slide right 4px + green left border — Metro list engagement cue.

---

## Theme preview

Clicking a `.swatch` in Preferences sets `--green` on `:root` immediately via JS; **Save** persists to `localStorage` (`x_th`). Matches Xbox profile accent picker behavior.

---

## Loading & empty states

| State | Treatment |
|-------|-----------|
| Initial catalog | Shimmer `.browse-card.is-loading` / `.addon-list-card.is-loading` |
| Game page | Full `.game-page-skeleton` layout mirroring final structure |
| Zero filter results | `.browse-empty` — icon, title, active chips, clear CTA |
| No media / recs | `.game-media-empty`, `.game-rec-empty` muted copy |
| Profile collections empty | `.profile-collections-empty` |
| Disabled download | `.dl-btn.dis` grayscale |

Empty states stay quiet — no illustrations.

---

## Responsive behavior

Primary breakpoint: **`max-width: 900px`**

| Component | Desktop | ≤ 900px |
|-----------|---------|---------|
| `--page-x` | 60px | 18px |
| Site hero | Two-column grid | Single column; smaller cover fan |
| Featured row | 3-column grid | Horizontal snap carousel (~85vw cards) |
| Genre section | Below featured | **Above** featured (`order: -1`) |
| Game page | Sidebar + main grid | Stacked column |
| Game meta | 4 columns | 2 then 1 column |
| Profile identity | 3-column grid | Stacked |
| Overlay `--fit` | `min(680px, 100dvh - 32px)` | Full viewport padding with safe areas |
| Account settings | Sidebar + form grid | Stacked |

Secondary: **`max-width: 520px`** — genre chips 2-column.

Header search stays in nav row; filter drawer drops below catalog title actions.

---

## URL-synced state

| Param | Meaning |
|-------|---------|
| `?title=` | Open game page |
| `?profile=` | Open profile hub |
| `?genre=` | Active genre filter |
| `?package=` | Add-on type filter (DLC mode) |

Pivot category is not in URL. Clearing game/profile params returns to browse.

---

## Do / Don't

### Do

- Use `--green` (or user theme) for all primary focus/selection
- Keep chrome dark; let cover art supply color
- Uppercase + letter-spacing for nav/section labels only
- Round interactive surfaces (`--r-md` minimum on tap targets)
- Scrim text on all photo-backed components
- Match cover aspect ratio to `--t-w` / `--cover-visible-h`

### Don't

- Introduce light theme without full token audit
- Rest shadow on every tile — shadow is hover/reward
- Use sharp 0px radius on new interactive surfaces
- Replace Segoe UI with display fonts
- Document `.browse-shelf` / `#dimmer` as active flows — they are legacy CSS
- Add page-number pagination — catalog uses infinite scroll

---

## Reference map: Xbox concept → xbx.place

| Xbox / Metro concept | Implementation |
|----------------------|----------------|
| Hub pivots | `.pivot` |
| Store search | `#q` in header |
| Refine / sort | `.browse-filter-drawer` |
| Active filters | `#browseFilterBar` chips |
| Game tile grid | `.browse-grid` / `.browse-card` |
| Hero row | `.browse-hero-grid` |
| Genre row | `.genre-grid--rail` |
| Marketing hero | `.site-hero` |
| Title detail page | `#gamePage` / `.game-page` |
| Download hub | `#downloadMod` |
| Profile / clubs | `#profilePage`, collections |
| Accent color | Preferences swatches → `--green` |
| Related row | `.game-rec-scroll`, `.game-media-scroll` |
| Guide / back to top | `#btt` |
| Acrylic top bar | `.header` frost |
| Achievement score badge | `.browse-tile-score--*` tiers |

---

## Extending the system

When adding a new surface:

1. Pick surface color from the dark stack (`--tile` or `--surface-raised`).
2. Radius: `--r-md` controls, `--r-lg` panels.
3. Wire hover/focus to 2px `--green` border or 4px underline.
4. If modal: use `.overlay` + `.game-modal-page-shell`; prefer `.overlay--fit` for pickers.
5. If photo-backed: add bottom scrim before placing text.
6. Update this doc, [components.md](./components.md), and [tokens.css](./tokens.css).
