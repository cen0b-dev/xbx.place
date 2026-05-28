# Foundations

Foundational tokens and rules for xbx.place. Values map directly to `src/styles.css` unless noted.

---

## Design lineage: Metro → Fluent → Xbox

### Original Metro (circa 2012–2015)

- **Content over chrome**: typography and imagery carry the page; chrome is minimal.
- **Flat color blocks**: solid fills, no skeuomorphism.
- **Sharp geometry**: tiles were often square or rectangular with **no radius**.
- **Pivot headers**: horizontal category switches with underline accent (Windows Phone / Xbox One Store).
- **Semantic color**: Microsoft palette slots (green, blue, red, purple, yellow) for accents and badges.

### Xbox One dashboard (2013–2020)

- **Tile grid** as the primary browse pattern (game covers as rectangles).
- **Green (#107C10)** as the signature Xbox accent on dark `#101010`-class backgrounds.
- **Blades / side panels**: detail views that feel like sliding panes (originally literal blade UI; here approximated with centered overlays).
- **Uppercase section titles** with letter-spacing (`FEATURED`, `ALL GAMES`).
- **Dimmed backdrop** when a tile or panel is focused (spotlight on selection).

### Xbox Series X|S & modern Fluent (2020+)

- **Rounded corners** on tiles, buttons, and panels (8–16px typical).
- **Layered depth**: soft shadows, subtle gradients, frosted sticky headers (`backdrop-filter`).
- **Hover lift**: scale + translateY on hero cards; scale on grid tiles.
- **Pill badges** and circular color pickers instead of hard squares.
- **Horizontal carousels** with snap scrolling (`rec-row`, shelf grids).

xbx.place intentionally sits **between One and Series**: pivot + tile grid + blades from One; rounded corners, shadows, glass header, and carousel rows from Series/Fluent.

---

## Color

### Core palette (dark theme only)

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | `#101010` | Page background, footer, scrollbar corner |
| `--tile` | `#202020` | Default tile/card surface |
| `#252525` | — | Inputs, active tile fill, info panels, icon buttons |
| `#1f1f1f` | — | Blades, pagination buttons, close button base |
| `#151515` | — | Modal left rail, settings footer |
| `#181818` | — | Expandable shelf container |
| `#333` / `#3a3a3a` | — | Borders, dividers, inactive chrome |
| `--text` | `#ffffff` | Primary copy |
| `--text-sec` | `#aaaaaa` | Section titles, secondary labels |
| `#888` / `#666` | — | Muted meta, inactive pivots/tabs |
| `--green` | `#107C10` | **Primary accent** (themeable) |

### Accent & theme colors

Default accent is **Xbox green**. Users can pick from the Xbox/Microsoft accent set (stored in `localStorage` as `x_th`):

| Name | Hex | Microsoft / Xbox association |
|------|-----|------------------------------|
| Xbox Green | `#107C10` | Default; Series branding, success, focus |
| Microsoft Blue | `#0078D7` | Windows accent |
| Red | `#E81123` | Error / alert family |
| Purple | `#881798` | Xbox legacy purple accent |
| Yellow | `#FFB900` | Warning / highlight |

Accent usage:

- Active pivot underline (4px bottom border)
- Active tab underline (4px bottom border)
- Tile/card hover and focus border (2px)
- Hero card hover border
- Blade accent stripe (top 4px on small blade, left 6px on large blade)
- Shelf top stripe (4px)
- Settings group labels, info grid labels
- Badge backgrounds, active pagination, back-to-top FAB
- Scrollbar thumb hover gradient (green blend)
- Link hover in footer

**Rule**: One accent color drives all interactive emphasis. Do not mix multiple accent hues on the same view except in the theme picker itself.

### Semantic & utility colors

| Context | Colors | Notes |
|---------|--------|-------|
| Star ratings | `gold` / `#444` off | Classic marketplace pattern |
| Discord CTA | `#5865F2` → `#4752C4` hover | External brand exception |
| Proxy warning | bg `#241b1b`, border `#5b2f2f`, text `#ffd7d7` | Error-adjacent, not accent green |
| Overlay scrim | `#000000` at ~75–80% opacity | `#000c`, `#000d` |
| Skeleton shimmer | `#252525` ↔ `#333333` | Loading placeholder |

### Gradients

Used sparingly for depth, not decoration:

- **Hero info footer**: `linear-gradient(to top, rgba(0,0,0,0.9), transparent)` — legibility over art
- **Modal background wash**: masked fade on full-bleed background image
- **Scrollbar track/thumb**: vertical gray gradients; thumb hover adds green
- **Recommendation cards**: `linear-gradient(180deg, #232323, #1b1b1b)` with hover lightening

---

## Typography

### Font stack

```css
--font: "Segoe UI", "Helvetica Neue", sans-serif;
```

**Segoe UI** is non-negotiable for Metro/Fluent fidelity on Windows; Helvetica Neue and system sans fall back elsewhere.

Static pages (`about.html`, `dmca.html`) currently use Inter — consider aligning to Segoe UI for consistency in future passes.

### Scale & weight

| Element | Size | Weight | Transform | Tracking |
|---------|------|--------|-----------|----------|
| Brand (`h1`) | `2.2rem` | 300 (600 on accent span) | none | `-1px` letter-spacing |
| Pivots | `1.6rem` | 300 (400 active) | **uppercase** | default |
| Section titles (`.sec-title`) | `1.2rem` | 600 | **uppercase** | `1px` |
| Hero title (inline) | `1.4rem` | default | none | text-shadow for contrast |
| Modal title (`h2`) | `clamp(1.5rem, 2.1vw, 2.2rem)` | 300 | none | tight line-height 1.15 |
| Tabs | `1rem` | 600 | **uppercase** | `1px` |
| Settings / info labels | `0.75–0.8rem` | 600 | **uppercase** | — |
| Body / descriptions | `0.85–0.95rem` | 400 | none | line-height ~1.6 in prose |
| Badges | `0.7rem` | default | none | — |
| Footer | `0.9rem` | 400 | none | — |

### Typographic principles

1. **Light headings, heavy labels**: Display type uses weight 300; structural labels use 600 uppercase — classic Metro hierarchy inversion.
2. **Uppercase = navigation/structure**; sentence case = content (descriptions, download names).
3. **No serif, no rounded novelty fonts** — stay in the Microsoft system lane.
4. **Text on imagery** always gets shadow or gradient scrim; never rely on raw photo contrast alone.

---

## Spacing & layout

### Page grid

| Region | Padding | Max width |
|--------|---------|-----------|
| Header | `30px 60px 0` | full bleed sticky |
| Main container | `40px 60px` | `1600px` centered |
| Footer | `40px 60px` | full bleed |
| Modal overlay | `24px` (12px mobile) | — |

### Component gaps

- Pivot row gap: `40px`
- Header internal gap: `20px`
- Control cluster gap: `10–15px`
- Tile grid gap: `20px`
- Hero grid gap: `20px`
- Tab row gap: `22px` (16px mobile)
- Recommendation row gap: `12px`

### Tile geometry

```css
--t-w: 170px;   /* min column width in auto-fill grid */
--t-h: 235px;   /* fixed tile height — portrait cover ratio */
--cover-crop-top: 37px; /* hides empty strip on X360 cover scans */
```

Cover images are **cropped from the top** (`margin-top: -37px`, `object-position: top center`) so box art fills the tile — a data-driven layout hack, not arbitrary decoration.

Hero row: **3-column** grid, fixed `250px` height (single column × `200px` card height below 900px).

---

## Border radius (rounded Metro)

```css
--r-sm: 8px;   /* pagination, nav buttons, close, thumbs */
--r-md: 12px;  /* tiles, inputs, download rows, covers in modal */
--r-lg: 16px;  /* hero cards, blades, shelf */
```

Additional radii:

- **Pill badges / dots**: `999px` (full round)
- **Back-to-top FAB**: `14px` (squircle feel)
- **Rec item thumbnails**: `6px`
- **Skeleton**: `2px` (minimal, loading-only)

**Guidance**: Prefer `--r-md` for anything thumb-sized users tap; `--r-lg` for panels and hero surfaces; `--r-sm` for dense control chrome.

---

## Elevation & borders

Metro was flat; Series UI adds depth. xbx.place uses **both**:

| Level | Technique | Example |
|-------|-----------|---------|
| 0 | 1px `#333` divider | Section title bottom border |
| 1 | 2px transparent → accent on hover | Tiles |
| 2 | `box-shadow: 0 10px 20px rgba(0,0,0,0.5)` | Hero hover, active tile |
| 3 | `box-shadow: 0 25px 50px rgba(0,0,0,0.75)` | Blades, open shelf |
| Accent stripe | 4px or 6px solid `--green` | Blade/shelf edge — Xbox "selected pane" cue |

Sticky header: `#101010` at ~95% opacity + `backdrop-filter: blur(10px)` + bottom border — **Fluent acrylic** simplified for web.

---

## Motion

Global transition default: **`0.2s`** (tiles, borders, overlays, buttons). Exceptions:

| Animation | Duration | Easing | Use |
|-----------|----------|--------|-----|
| Shimmer skeleton | `1.5s` | linear infinite | Loading grid |
| Tab content fade | `0.3s` | default (`fadeIn`) | Blade tab switch |
| Shelf expand | `0.3s` | default | max-height + opacity |
| Back-to-top | `0.3s` | default | opacity/pointer |
| Hero bg zoom | `0.4s` | default | hover scale on background |

### Interaction transforms

- **Tile hover/active**: `scale(1.05)` + green border + shadow (Series "pop forward")
- **Hero card hover**: `translateY(-5px) scale(1.02)` + border + bg opacity shift
- **Download row hover**: `translateX(5px)` + left accent border — Metro list slide cue
- **Blade enter**: overlay fade + blade `scale(0.95 → 1)`
- **Dimmed tiles** (DLC context): `grayscale(100%)` + `opacity 0.4` until hover

Avoid bouncy easing; keep motion **snappy and functional**, like console UI.

---

## Scrollbars

Custom webkit + `scrollbar-width: thin` for Firefox:

- 13px width, dark track gradient
- Rounded thumb with inset border
- Hover thumb tints toward Xbox green

This matches the **premium dark shell** feel of Xbox settings apps.

---

## Iconography

**Font Awesome 6 Solid** (`@fortawesome/fontawesome-free`) for UI chrome:

- Settings: `fa-gear`
- Close: `fa-xmark`
- Download: `fa-download`
- Pagination: `fa-chevron-left/right`
- Back to top: `fa-arrow-up`
- Stars: `fa-star` / muted `off` class

Icons are **functional**, not decorative — paired with text labels on primary actions where possible.

---

## Accessibility notes

- Focus styles largely mirror hover (green border) — ensure `:focus-visible` parity when extending components.
- Icon buttons require `aria-label` (implemented on settings, close, gallery nav).
- Overlay modals use fixed full-screen scrim; body dimming via `#dimmer` for shelf focus.
- Color contrast: white on `#202020` passes; secondary `#aaa` on `#101010` is for non-critical labels only.
