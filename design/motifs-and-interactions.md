# Motifs & Interactions

Visual motifs, behavioral patterns, and Xbox/Metro interaction vocabulary used across xbx.place.

---

## Core motifs (visual DNA)

### 1. Cover-forward tiles

The **game box shot** is the atomic UI unit — not list rows, not text tables. This mirrors:

- Xbox One **My Games** grid
- Xbox Store browse pages
- Windows 8 Metro **live tile** grids (static images here, no live tiles)

Covers use **pixelated/crisp-edges** rendering where appropriate — a nod to legacy box art and emulator aesthetics, not glossy web photo treatment.

### 2. Green focus ring

Selection is communicated with a **2px `--green` border**, not glow halos or thick outlines. Appears on:

- Hovered/active tiles and hero cards (`:focus-visible` parity on `.browse-card`, `.browse-hero-card`)
- Pagination hover
- Icon buttons (icon color shift)
- Thumbnail borders in gallery

This is the **Xbox accent focus** pattern carried from One through Series (Series often uses green glow on dashboard; web translation = solid border + shadow).

### 3. Accent stripe on panels

**Blades** and the **DLC shelf** use a thick green edge:

| Component | Stripe position | Width |
|-----------|-----------------|-------|
| `.blade.sm` | Top | 4px |
| `.blade.lg` | Left | 6px |
| `.browse-shelf` | Top | 3px |
| `.site-hero` | Left | 6px |

Evokes Xbox **blade separator** and Series **sidebar indicator** without literal sliding animation.

### 4. Uppercase structural type

Navigation and section boundaries shout in caps:

- Pivots: `GAMES`, `ADDONS & DLC`
- Tabs: `OVERVIEW`, `DOWNLOADS`, `GALLERY`
- Section rails: `TOP RATED`, `BROWSE BY GENRE`, `ALL GAMES`
- Field labels: `DEVELOPER`, `PUBLISHER`, `REGIONS`

Body copy stays sentence case — Metro **type hierarchy as wayfinding**.

### 5. Dark stack layers

Background depth progresses **#101010 → #202020 → #252525 → frosted panels** — never pure black except scrims. Keeps artwork and green accents readable on OLED-style blacks without crushing shadow detail.

### 6. Gradient scrims on imagery

Text never sits on raw photos:

- Hero bottom gradient
- Tile overlay solid scrim
- Modal `.m-bg` masked fade

Console UIs always **legibility-mask** hero art; this is mandatory when adding new image-backed components.

### 7. Pill micro-elements

Badges, pagination dots, theme swatches, gallery dots use **full rounding** — the primary "Series rounded Metro" break from 2012 sharp tiles.

---

## Interaction patterns

### Pivot navigation

```
[ GAMES ]──────  ADDONS & DLC
   ↑ 4px green underline, white text
```

- Instant category switch (no page reload)
- Inactive pivots recede to `#666`
- Single active pivot — binary hub model like Xbox top-level hubs

### Tile → detail flow

1. Click catalog tile → full-page game view (`body.game-view`, `#gamePage`)
2. URL updates with `?title=` for deep linking
3. History back closes game page
4. Background artwork loads in `.game-page-bg`

Alternative path: in **Addons & DLC** mode, click tile → **shelf opens inline** below grid, page dims via `#dimmer`.

### Browse toolbar

Sort and region filters live in the sticky header toolbar (`.browse-toolbar-row`), separate from category pivots and search. Active genre/region/search appear as removable chips in `#browseFilterBar`.

### Scroll reveal

Sections, hero cards, genre chips, and grid tiles use `.reveal` + IntersectionObserver stagger (`src/reveal.ts`, `--reveal-delay`).

### Hover = preview, click = commit

- **Hover tile**: scale + green border (metadata always visible via bottom scrim)
- **Click tile**: open game page or shelf (commit)
- **Hover hero**: stronger motion (lift + image zoom) — featured tier gets more motion budget
- **`prefers-reduced-motion`**: suppresses tile scale transforms

### Focus stacking (z-index model)

| Layer | z-index | Purpose |
|-------|---------|---------|
| `#dimmer` | 1000 | Page dim |
| `.browse-shelf` | 1001 | Inline panel |
| Active/hover tile | 1002 | Above dimmer |
| `#btt` | 2000 | FAB |
| `.header` | 2500 | Always reachable chrome |
| `.overlay` | 3000 | Modals |

When extending UI, preserve **modal > header > FAB > shelf > dimmer**.

### Download rows

Hover slides row **5px right** with green left border — Metro **list item engagement** cue (similar to Xbox download queue rows).

### Settings theme preview

Clicking a `.dot` swatch sets `--green` live via `document.documentElement.style.setProperty` before save — immediate accent feedback like Xbox profile color pickers.

### Gallery carousel

- Prev/next chevrons in bordered squares (`--r-sm`)
- Dot indicators + thumb strip
- Main image click opens full image in new tab
- Keyboard-friendly button elements (`type="button"`, aria labels)

### Recommendations row

Horizontal scroll with **scroll-snap** — Xbox **row of tiles** pattern on Series home. Cards are compact landscape chips, not full portrait tiles.

---

## Loading & empty states

| State | Treatment |
|-------|-----------|
| Catalog loading | 20× `.browse-card.is-loading` shimmer in grid |
| Zero filter results | `.browse-empty` panel with clear-filter actions |
| No gallery images | Muted `#666` text |
| No recommendations | `.rec-empty` muted copy |
| Disabled downloads | `.dl-btn.dis` / `.s-item.dis` grayscale |

Keep empty states **quiet** — no illustrations, no bright colors.

---

## Responsive behavior (`max-width: 900px`)

Breakpoints compress the **living room → tablet** transition:

| Component | Desktop | Mobile |
|-----------|---------|--------|
| Hero grid | 3 columns | Horizontal snap carousel (~85vw cards) |
| Genre section | Below featured | Above featured (`.browse-discovery` order) |
| Site hero | Full banner | Single column; compact mode on return visit |
| Header padding | `--page-x: 60px` | `--page-x: 18px` |
| Game page layout | Side-by-side | Stacked column |
| Modal padding | 24px | 12px |
| Cover rail | Vertical panel | Horizontal 220px strip |
| Info grid | 2 columns | 1 column |
| Gallery | 340px max height | 220px |
| Rec items | ~30% width | 80% width |

Blade loses `--r-lg` on small screens (`border-radius: 6px`) — tighter mobile sheet feel.

Header horizontal padding uses `--page-x` (60px desktop, 18px mobile).

---

## Sound & haptics

None on web. Motion substitutes for console haptic/audio feedback — keep transitions short.

---

## Do / Don't

### Do

- Use `--green` (or user theme) for all primary focus/selection
- Keep chrome dark; let cover art supply color
- Use uppercase + letter-spacing for nav labels only
- Round interactive surfaces (`--r-md` minimum)
- Add scrims under text on photos
- Use scale transforms sparingly on **selected/hovered** elements only

### Don't

- Introduce light theme without full token audit
- Use drop shadows on every tile at rest (shadow = hover/focus reward)
- Mix Discord blue into focus states (reserved for external CTA)
- Use sharp 0px radius on new components (breaks Series Fluent blend)
- Replace Segoe UI with display fonts
- Add skeuomorphic buttons (glass beads, metal textures) — flat Metro base with subtle depth only

---

## Reference map: Xbox era → xbx.place

| Xbox / Metro concept | xbx.place implementation |
|----------------------|---------------------------|
| Hub pivots | `.pivot` row |
| Browse toolbar | `.browse-toolbar-row` (sort, region, chips) |
| Game tile grid | `.browse-grid` / `.browse-card` |
| Hero spotlight | `.browse-hero-grid` / `.browse-hero-card` |
| Site marketing hero | `.site-hero` |
| Genre filters | `.genre-grid` / `.genre-chip` |
| Accent color profile | Settings theme dots → `--green` |
| Related content row | `.browse-shelf`, `.rec-row` |
| Spotlight dimming | `#dimmer` + `.browse-card--dim` |
| Store detail page | `.game-page` full-page view |
| Guide button / top | `#btt` FAB (web adaptation) |
| Acrylic top bar | `.header` backdrop blur (`var(--header-frost)`) |

---

## Extending the system

When adding a new surface:

1. Pick surface color from the dark stack (`--tile` or `#252525`).
2. Assign radius: md for controls, lg for panels.
3. Wire focus/hover to `--green` 2px border or 4px underline.
4. If overlay: use `.overlay` + `.blade` pattern and z-index table.
5. Document new classes here and tokens in `tokens.css`.
