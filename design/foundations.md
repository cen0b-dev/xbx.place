# Foundations

Foundational tokens and rules for xbx.place. Canonical runtime values live in `src/styles.css` `:root`. Reference copy in [tokens.css](./tokens.css).

---

## Design lineage

xbx.place sits between **Xbox One Store** and **Series X|S Home**:

| Era | What we borrow |
|-----|----------------|
| Metro / Win8 | Content over chrome, uppercase nav labels, flat fills |
| Xbox One | Green accent on `#101010`, pivot hubs, cover tile grids |
| Series / Fluent | Rounded corners (8–16px), frosted sticky header, hover lift, pill badges |

We do **not** use literal blade sliding panels or live tiles. Detail views are a **full-page game layout** plus **centered modal sheets** (`.overlay--fit`).

---

## Color

### Surface stack (dark theme only)

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | `#101010` | Page, footer, scroll corner |
| `--tile` | `#202020` | Grid tile base, skeleton |
| `--surface-raised` | `#252525` | Inputs, chips, account trigger |
| `--surface-panel` | `#1f1f1f` | Filter drawer, dropdown menus |
| `--surface-card` | `#1a1a1a` | Hero cards, profile tiles |
| `--surface-rail` | `#151515` | Featured/genre section rails |
| `--surface-shelf` | `#181818` | Hero gradient base (legacy shelf token) |
| `--border-subtle` | `#333333` | Section dividers, tile borders |
| `--border-control` | `#3a3a3a` | Input borders, filter trigger |

### Text

| Token | Hex | Use |
|-------|-----|-----|
| `--text` | `#ffffff` | Primary copy |
| `--text-body` | `#cccccc` | Hero lead, filter chips, body |
| `--text-sec` | `#aaaaaa` | Section titles, placeholders |
| `--text-muted` | `#888888` | Meta, inactive copy |
| `--text-faint` | `#666666` | Micro-labels, pivot idle |
| `--label-muted` | `#7a7a7a` | Form/meta labels |

### Accent (themeable)

Default: **`--green: #107C10`** (Xbox green). User picks from five slots in Preferences (`localStorage` key `x_th`):

| Slot | Hex |
|------|-----|
| Xbox Green | `#107C10` |
| Microsoft Blue | `#0078D7` |
| Red | `#E81123` |
| Purple | `#881798` |
| Yellow | `#FFB900` |

**Rule:** One accent drives interactive emphasis per view. Swatches in settings are the only place multiple hues appear together.

Accent appears on: active pivot underline, active genre chip ring, tile/card hover border, filter trigger when active, primary `.btn`, meta labels (`game-meta-label`), download row left border on hover, scrollbar thumb hover tint.

### Community score tiers

Converted from 5-star rating to 0–100 display on tiles and game page:

| Tier | Token | Background | When |
|------|-------|------------|------|
| Exceptional | `--score-exceptional` | `#66cc33` | ≥ 90 |
| Great | `--score-great` | `#9acd32` | ≥ 80 |
| Good | `--score-good` | `#ffcc33` | ≥ 70 |
| Low | `--score-low` | `#666666` | > 0 |
| Unrated | — | `#2e2e2e` + border | 0 → shows **NR** |

### Stars

| Token | Value |
|-------|-------|
| `--star-active` | `#c9a227` |
| `--star-inactive` | `#444444` (24% opacity on `.off`) |

### Semantic (non-accent)

| Context | Colors |
|---------|--------|
| Success notice / status | `#17301d` bg, `#2f6b3b` border, `#cfffcd` text |
| Error / auth error | `#241b1b` bg, `#5b2f2f` border, `#ffd7d7` text |
| MiNERVA magnet button | `#e8a020` icon, brighter on hover |
| Modal scrim | `--scrim-modal` `rgba(0,0,0,0.75)` |
| Header frost | `--header-frost` `rgba(16,16,16,0.95)` + `backdrop-filter` implied via opaque fill |

### Gradients

Used for legibility, not decoration:

- Tile bottom scrim (persistent + stronger on hover)
- Hero / game-page background washes (`color-mix` with `--bg`)
- Site hero crossfade slides + green radial glow
- Profile banner fallback (accent-tinted mesh)

---

## Typography

### Font stack

```css
--font: "Segoe UI", "Helvetica Neue", sans-serif;
```

Static pages (`about.html`, `dmca.html`) still use Inter — optional future alignment.

### Scale & weight

| Element | Size | Weight | Transform |
|---------|------|--------|-----------|
| Brand (`h1`) | `2.2rem` | 400 (600 on `span`) | — |
| Pivots | `1.6rem` | 400 active | **uppercase** |
| Section title (`.game-section-title`) | `1.2rem` | 600 | **uppercase**, `1px` tracking |
| Site hero title | `clamp(1.75rem, 3vw, 2.55rem)` | 400 (600 on accent span) | — |
| Game page title | `clamp(1.65rem, 2.4vw, 2.45rem)` | 500 | — |
| Modal title | `clamp(1.5rem, 2.1vw, 2.2rem)` | 400 | — |
| Meta / filter labels | `0.68–0.75rem` | 600–700 | **uppercase** |
| Body / descriptions | `0.85–0.95rem` | 400 | line-height ~1.55–1.65 |
| Tile title | `0.92rem` | 600 | 2-line clamp |

### Principles

1. **Uppercase + letter-spacing = structure** (pivots, section headers, field labels).
2. **Sentence case = content** (descriptions, download filenames after parsing).
3. **Light display, semibold labels** — Metro hierarchy inversion.
4. Text on imagery always has gradient scrim or shadow; never raw photo contrast alone.

---

## Spacing & layout

### Page grid

| Region | Token / value |
|--------|----------------|
| Max content width | `--page-max: 1600px` |
| Horizontal padding | `--page-x: 60px` (18px ≤ 900px) |
| Vertical padding | `--page-y: 40px`, bottom `--page-bottom: 64px` |
| Header top | `30px` + `--page-x` sides |
| Browse shell | `40px` vertical padding inside max-width column |
| Addon list max | `--addon-list-max: 960px` (centered in DLC mode) |

### Common gaps

- Pivot gap: `40px`
- Grid gap: `20px` (`--space-grid-gap`)
- Genre chip gap: `10px`
- Hero grid gap: `14px`
- Filter drawer internal: `16–20px`
- Game page sidebar/main: `40px` (stacks on mobile)

---

## Cover art & tile geometry

Reference box art dimensions (x360db):

```css
--t-w: 280px;
--t-h: 387px;
--cover-crop-top: 37px;
--cover-visible-h: calc(var(--t-h) - var(--cover-crop-top));
```

**Visible ratio** drives all `aspect-ratio: calc(var(--t-w) / var(--cover-visible-h))` containers (grid tiles, game cover, hero fan covers).

### Crop implementation (two layers)

1. **CSS fallback:** `.cover-crop-view > img` shifted up via `transform: translateY(calc(-100% * var(--cover-crop-top) / var(--t-h)))` to hide the Xbox 360 header strip.
2. **Canvas crop (`cover-crop.ts`):** When CORS allows, top ~48px (scaled to natural width) is rasterized off; result cached as blob URL and class `is-raster-cropped` removes the CSS shift.

Grid uses `repeat(auto-fill, minmax(var(--t-w), 1fr))` with `--grid-col-min: 280px`.

---

## Border radius

```css
--r-sm: 8px;    /* back links, small controls, score badge */
--r-md: 12px;   /* tiles, inputs, download rows, modals inner */
--r-lg: 16px;   /* hero cards, sections, overlay panels */
--r-pill: 999px; /* stats, filter chips, avatar */
--r-fab: 14px;  /* back-to-top */
```

Game page score badge uses `5px` (Metacritic-style rectangle).

---

## Elevation & borders

| Level | Technique | Example |
|-------|-----------|---------|
| Rest tile | 2px transparent border | `.browse-card` |
| Hover / focus | Green 2px border + optional shadow | `--shadow-tile-hover` |
| Panel | 1px `#333` + soft shadow | `.game-modal-panel`, filter drawer |
| Overlay sheet | `--shadow-panel` on `.overlay--fit .game-modal` | Download modal |
| Section rule | 1px `--border-subtle` under `.browse-section-head` | Catalog header |

Sticky header: `--header-frost` fill + bottom `1px` border — simplified acrylic (no blur in all browsers; opacity simulates glass).

---

## Motion

| Pattern | Duration / easing | Notes |
|---------|-------------------|-------|
| Default transition | `0.2s` | Borders, buttons, hovers |
| Reveal on scroll | `0.55s` `cubic-bezier(.22,1,.36,1)` | Stagger via `--reveal-delay` |
| Game page enter | `0.45s` same easing | `gamePageEnter` keyframe |
| Overlay modal | `0.28s` scale/translate | `.overlay--fit` |
| Shimmer skeleton | `1.5s` linear infinite | Loading tiles |
| Hero slide crossfade | `20s` | `.site-hero-slide` |
| Hero cover float | `8s` | Subtle vertical bob |

### Interaction transforms

- **Grid tile hover:** `scale(1.02)` + green border (disabled under `prefers-reduced-motion`)
- **Hero card hover:** `translateY(-3px)` + image `scale(1.04)`
- **Download row hover:** `translateX(4px)` + green left border
- **Hub tile / collection game hover:** `translateY(-2px)`

Avoid bouncy easing; motion is functional like console UI.

---

## Scrollbars

Custom webkit + `scrollbar-width: thin` on `body`:

- 13px width, dark track gradient
- Pill thumb with inset border; hover tints toward `--green`
- Horizontal genre/hero rails use thin 6px scrollbars where overflow

---

## Iconography

**Font Awesome 7 Free** (solid) — functional chrome only:

| Icon | Use |
|------|-----|
| `fa-compact-disc` | Browse catalog CTA |
| `fa-sliders` | Filters, Preferences menu |
| `fa-download` / `fa-magnet` | Archive / MiNERVA |
| `fa-bookmark` | Collections |
| `fa-chevron-left` | Back links |
| `fa-star` | Ratings |

Pair icons with text on primary actions where space allows.

---

## Accessibility

- `:focus-visible` mirrors hover on tiles, chips, triggers (green outline, 2–3px offset).
- Icon-only controls need `aria-label` (filter close, scroll prev/next, account).
- Filter drawer uses `role="dialog"`; account menu `aria-label="Account"`.
- `prefers-reduced-motion: reduce` disables reveal transforms, hero animations, tile scale.
- Secondary gray (`#888` on `#101010`) for non-critical labels only; body copy prefers `#ccc`+.
