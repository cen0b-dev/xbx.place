# Components

Component-level specs for xbx.place. Class names match `src/styles.css` and markup in `src/main.ts`.

---

## App shell

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER (sticky, frosted)                                    │
│  brand · account · pivots · search                           │
│  BROWSE TOOLBAR: sort catalog · region · active filter chips │
│  PIVOTS: GAMES | ADDONS & DLC                                │
├─────────────────────────────────────────────────────────────┤
│  BROWSE PAGE (max 1600px, `.browse-page-shell`)              │
│  SITE HERO (marketing banner, compact on return visit)       │
│  TOP RATED row (3 hero cards; carousel on mobile)            │
│  BROWSE BY GENRE (chip grid; above featured on mobile)       │
│  CATALOG: title + count · tile grid + pager · empty state    │
│  SHELF (inline expand, DLC)                                  │
├─────────────────────────────────────────────────────────────┤
│  FOOTER                                                      │
└─────────────────────────────────────────────────────────────┘
     [dimmer layer when shelf/tile focused]
     [game details full-page view: body.game-view]
     [overlays: settings | download | collection | auth]
     [back-to-top FAB]
```

View modes: default browse, `body.game-view` (title detail), `body.profile-view` (profile hub), `body.browse-mode-dlc` (DLC pivot active — contextual hero/featured copy).

---

## Header (`.header`)

**Role**: Persistent navigation chrome — Xbox **Store pivot bar** analogue.

| Part | Classes | Behavior |
|------|---------|----------|
| Sticky bar | `.header` | Sticks to top; blurred dark fill; `z-index: 2500` |
| Brand | `.brand h1` | `xbx.` light + `place` in accent green |
| Controls | `.controls` | Account trigger, settings |
| Pivots | `.pivot` | Category switch; active = white text + 4px green bottom border |
| Search | `.nav-search .inp` | Debounced catalog filter |

Pivot inactive color `var(--text-muted)`; hover `var(--text-sec)`. Only one pivot active at a time.

### Browse toolbar (`.browse-toolbar-row`)

**Role**: Unified catalog refinement — sort, region, and active filter chips. Lives in the sticky header below pivots/search.

| Part | Classes | Behavior |
|------|---------|----------|
| Toolbar row | `.browse-toolbar-row` | Hidden in `body.game-view` / `body.profile-view` via `.browse-only` |
| Controls | `.browse-toolbar-controls` | Sort + region dropdowns |
| Field label | `.browse-toolbar-label` | Uppercase micro-label (`Sort catalog`, `Region`) |
| Sort | `#sort` `.ui-dropdown--compact` | Catalog sort (rating, A–Z, newest) |
| Region | `#browseReg` `.ui-dropdown--compact` | Filters featured + catalog; synced with settings `#reg` |
| Active filters | `#browseFilterBar` `.browse-filter-bar` | Genre, region, and search chips with clear actions |

Mental model: **header = mode + search**, **toolbar = refine catalog**.

---

## Site hero (`.site-hero`)

**Role**: Above-the-fold marketing banner with crossfading background slides, cover fan, stats, and CTAs.

| Part | Classes | Notes |
|------|---------|-------|
| Container | `.site-hero` | Left 6px green accent stripe, `--r-lg`, `--surface-shelf` fill |
| Background | `.site-hero-slides` / `.site-hero-slide` | Crossfading cover art (`heroCrossfade` 20s) |
| Copy | `.site-hero-eyebrow`, `.site-hero-title`, `.site-hero-lead` | Contextual copy in DLC mode via `#siteHeroEyebrow` etc. |
| Stats | `.site-hero-stat` | Game/add-on counts; `.site-hero-stat--emphasis` in DLC mode |
| Covers | `.site-hero-covers` / `.site-hero-cover` | Stacked fan with hover lift |
| Compact | `.site-hero--compact` | Collapsed bar for return visitors (`localStorage` `x_hero_seen`) |
| Toggle | `.site-hero-compact-toggle` | Expand/collapse control |

---

## Browse page (`.browse-page`)

**Role**: Primary catalog — Xbox Store grid analogue.

### Section title (`.game-section-title`)

Metro **hub section header** (shared with game details and modals):

- Uppercase, letter-spaced, `var(--text-sec)` color
- Bottom rule `1px solid var(--border-subtle)`
- Flex row: title left, controls (count) right

### Genre discovery (`.genre-grid` / `.genre-chip`)

**Role**: Genre filter chips — full-width flex grid below featured (above featured on mobile via `.browse-discovery` order).

| State | Visual |
|-------|--------|
| Default | `var(--surface-raised)`, `--r-md`, 1px border |
| Hover | Lighter border, subtle shadow |
| `.is-active` | `--selected-bg`, green border + inset ring |

Active genre syncs to URL `?genre=` and appears in `#browseFilterBar`.

### Filter bar (`.browse-filter-bar` / `.browse-filter-chip`)

Pill chips for active genre, region (when not "All Regions"), and search query. Includes per-chip dismiss and "Clear all" action.

### Hero grid (`.browse-hero-grid` / `.browse-hero-card`)

**Role**: **Top Rated** row — deterministic daily rotation of highest-rated titles (DLC mode: titles with add-ons).

| Property | Value |
|----------|-------|
| Layout | 3 equal columns desktop; horizontal snap carousel ≤900px |
| Card | `#1c1c1c` bg, `--r-lg`, 1px border; `<button>` element |
| Image | `.browse-hero-bg` full bleed, 84% opacity when loaded |
| Hover | Green border, `translateY(-3px)`, image scale 1.04 |
| Focus | `:focus-visible` 2px green outline |
| Text | `.browse-hero-copy` gradient shade; `.browse-hero-eyebrow` green micro-label |

Shared card factory: `createHeroCard()` in `src/browse-card.ts`.

Hero cards are **wide landscape** tiles; grid tiles below are **portrait covers**.

Section containers use `.browse-section--rail` (`--surface-rail` background, `--r-lg` radius).

### Tile grid (`.browse-grid` / `.browse-card`)

**Role**: Primary catalog grid.

```
┌──────────┐
│  cover   │  ← cropped X360 box art
│  (image) │
│──────────│
│ overlay  │  ← persistent bottom gradient (title, score, stars, badge)
└──────────┘
```

| State | Visual |
|-------|--------|
| Default | `var(--tile)`, `--r-md`, 2px transparent border; `<button>` element |
| Hover / `.active` | `scale(1.05)`, green border, `var(--shadow-tile-hover)`, `z-index: 1002` |
| `:focus-visible` | 2px green outline offset |
| `.browse-card--dim` | Grayscale + 40% opacity (contextual de-emphasis) |
| `.is-loading` | Shimmer pseudo-element |
| `.active` | Background `var(--surface-raised)` (selected for shelf) |

Shared card factory: `createGridCard()` in `src/browse-card.ts`.

### Tile overlay (`.browse-card-ov`)

- Always visible on loaded tiles (persistent bottom gradient via `::after` scrim)
- Title, Metacritic-style score (`.browse-tile-score--*`), stars, optional badge
- Score tiers use tokens: `--score-high`, `--score-mid`, `--score-low`, `--score-muted-*`

### Empty catalog (`.browse-empty`)

Shown when filters yield zero results: icon, title, active filter chips, and "Clear all filters" CTA.

### Tags (`.game-tag`)

- Rectangular `--r-sm`, uppercase micro-type
- Used on tile overlays and game details tags
- Platform variant: `.game-tag--platform` (green fill)

### Pagination (`.browse-pager` / `.page-btn`)

Centered control row below grid:

- Buttons: 38px min-height, `--r-sm`, dark `var(--surface-panel)`
- Active page: filled `--green`
- Hover: green border on enabled buttons
- `.page-meta`: muted count text

---

## DLC shelf (`.browse-shelf`)

**Role**: Inline panel — expands in-grid when a base game with addons is selected.

| State | Behavior |
|-------|----------|
| Collapsed | `max-height: 0`, `opacity: 0` |
| `.open` | Animates open, green **top** accent 3px, frosted panel shadow |

### Shelf item (`.s-item`)

- Row layout: title left, download affordance right
- `--r-md`, left 3px border → green on hover
- `.dis`: grayscale, no pointer, 50% opacity

---

## Game details page (`.game-page`)

**Role**: Full-page in-app title view (not a modal). Activated via `body.game-view`.

```
.game-page
├── .game-page-bg          (ambient cover art + shade)
└── .game-page-shell
    ├── .game-back-link
    └── .game-page-layout  (240px sidebar | main)
        ├── .game-page-sidebar
        │   ├── .game-page-cover-wrap.cover-crop-view
        │   └── .game-page-actions
        │       ├── .game-download-btn.btn
        │       ├── .game-collection-split
        │       └── .game-details-btn
        └── .game-page-main  (frosted radial panel)
            ├── .game-page-title
            ├── .game-page-rating / .game-page-tags
            ├── .game-page-desc
            ├── .game-page-meta
            ├── .game-section → .game-media-wrap
            └── .game-section → .game-rec-wrap
```

| Part | Notes |
|------|-------|
| Background | Cover art at 32% opacity, grayscale filter, horizontal scrim |
| Title | Weight 300, `clamp(1.5rem, 2.1vw, 2.2rem)` — matches modal titles |
| Meta labels | `.game-meta-label` — green uppercase micro-type |
| Sections | `.game-section-title` — shared with browse |
| Carousels | `.game-scroll-wrap` with prev/next pills and edge fade |
| Loading | `.game-page-skeleton` shimmer → `.game-reveal-block` stagger |

Shell padding: `var(--page-y) var(--page-x) var(--page-bottom)`.

---

## Overlay modals (`.overlay` / `.game-modal`)

**Role**: Full-screen modal layer for download, collection, auth, and settings.

### Shared shell

| Class | Role |
|-------|------|
| `.overlay.show` | Fixed scrim, pointer events on |
| `.game-modal` | Slide-in panel with optional ambient background |
| `.game-modal-bg-*` | Cover art wash (download, collection) or `--ambient` gradient (auth) |
| `.game-modal-page-shell` | Full-width outer shell (matches `.game-page-shell`); holds back button |
| `.game-modal-body--narrow` | 760px content column, centered in outer shell |
| `.game-modal-body--wide` | 980px content column, centered in outer shell |
| `.game-back-link` | Shared back/close control — sits in outer shell, left-aligned at `--page-x` |
| `.game-modal-header` | Eyebrow + title + subtitle |
| `.game-modal-eyebrow` | Green uppercase micro-label |
| `.game-modal-title` | Weight 300, same clamp as `.game-page-title` |
| `.game-modal-sub` | Game name / context, `var(--text-muted)` |
| `.game-modal-lead` | Section intro copy, `var(--text-body)` |
| `.game-modal-panel` | Frosted bordered panel |
| `.game-modal-footer` | Right-aligned actions |
| `.game-modal-footer--split` | Space-between layout (New + Save) |
| `.game-modal-footer-primary` | Primary CTA sizing in split footers |

Shell padding: `var(--page-y) var(--page-x) var(--page-bottom)`.

---

## Collection modal (`.collection-mod-shell`)

**Role**: Add/remove title from user collections. Opens from game details.

| View | ID | Content |
|------|-----|---------|
| Pick | `#collection-mod-pick-view` | Checkbox list of collections + split footer |
| Create | `#collection-mod-create-view` | Name + public toggle form |
| Empty | `#collection-mod-empty-view` | First-collection onboarding |

### Collection-specific components

| Class | Role |
|-------|------|
| `.collection-mod-row` | Selectable collection row (2px border, green when checked) |
| `.collection-badge` | Public/private pill badge (shared with profile) |
| `.collection-visibility-row` | Card-style public toggle in create form |
| `.collection-mod-status` | Success/error banner |

Uses `.game-modal-lead`, `.game-section-title`, `.game-modal-footer--split` — no duplicate lead/footer classes.

---

## Collection badge (`.collection-badge`)

Shared public/private visibility badge (modal + profile):

- Pill shape (`var(--r-pill)`)
- `.is-public`: `--badge-public-*` tokens
- `.is-private`: muted gray on `var(--surface-raised)`

---

## Search & form controls

### Text input (`.inp`)

- Background `var(--surface-raised)`, 2px border matching fill
- Focus: darker fill, border `--green`
- Radius `--r-md`, padding `8px 15px`
- Large variant: `.collection-inp` (1rem, 14×18 padding)

### Dropdown (`.ui-dropdown`)

Custom dropdown controls. Variants: `.ui-dropdown--compact` (browse toolbar), `.ui-dropdown--block` (settings).

Sort lives in browse toolbar `#sort`. Region in toolbar `#browseReg` (synced with settings `#reg`).

### Checkbox (`.ui-check`)

Shared checkbox with green fill when checked. Used in collection rows and visibility toggle.

### Primary button (`.btn`)

- Default: `var(--green)` fill
- Ghost: `.btn-ghost` on `var(--surface-raised)`
- `--r-md`, semibold, flex row with gap for icon+text

---

## Site preferences (`.game-modal` in `#setMod`)

**Role**: Device-local site preferences — theme accent and default catalog region.

| Part | Classes |
|------|---------|
| Eyebrow / title | `Site` / `Preferences` |
| Option rows | `.settings-option-row` with label, hint, and control |
| Theme picker | `.swatches` / `.swatch` inside `.settings-options` |
| Region filter | `.ui-dropdown--block` in `.settings-option-control--dropdown` |
| Save | `.game-modal-footer-primary` — "Save preferences" |

Theme colors defined in `THEME_COLORS` (`src/main.ts`). Stored in `localStorage` as `x_th` and `x_r`.

---

## Footer (`.footer`)

- Top border `var(--border-subtle)`, top margin `80px`
- Muted `var(--text-faint)` body; links `var(--text-muted)` → green hover
- Hidden in `body.game-view`

---

## Back to top (`#btt`)

- Fixed FAB bottom-right
- 50×50, `--green` fill, `14px` radius (squircle)
- Hidden until scroll threshold (`.show`)
- Hidden in `body.game-view` and `body.profile-view`

---

## Dimmer (`#dimmer`)

- Full-screen scrim layer, `z-index: 1000`, `var(--scrim-dimmer)`
- Active when `body.dimmed` — dims page behind focused tile/shelf
- Pair with elevated tile z-index for **spotlight focus**

---

## Legacy blade CSS (`.blade`)

Older blade modal styles remain in `src/styles.css` for reference but are **not wired** to the current game details flow. Title detail uses the full-page `.game-page` pattern instead.

---

## Static content pages

`public/about.html` and `public/dmca.html` use a **minimal prose layout** (860px column). They inherit dark bg `#101010` but not the full shell components.
