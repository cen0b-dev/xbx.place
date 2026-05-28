# xbx.place Design System

Design documentation for **xbx.place** — an Xbox 360 catalog that blends **Microsoft Metro** (content-first, typographic) with **Xbox One / Series X|S shell** patterns: dark stack surfaces, cover-forward tiles, pivot navigation, and accent-driven focus.

**Implementation:** `src/styles.css` (tokens + components), `src/main.ts` (shell markup), `src/browse-card.ts` (tile factories), `src/cover-crop.ts` (box-art crop), `src/auth-ui.ts` (account + profile).

## Documents

| Document | Contents |
|----------|----------|
| [Website overview](./website-overview.md) | Product scope, catalog scale, features, downloads, workarounds |
| [Foundations](./foundations.md) | Color, type, spacing, radius, elevation, motion, tokens |
| [Components](./components.md) | Header, browse, game page, modals, profile hub, controls |
| [Motifs & Interactions](./motifs-and-interactions.md) | Visual DNA, flows, z-index, responsive rules |
| [Tokens](./tokens.css) | CSS custom properties reference |

## Design intent

The UI should feel like browsing a **modern Xbox library** on a dark display: large cover art, horizontal discovery rows, hub pivots (`GAMES` / `ADDONS & DLC`), and **full-page title detail** with frosted content panels. Unlike flat Win8 Metro, xbx.place uses **softened Metro** — 8–16px radii, glassy sticky header, subtle shadows, and a single themeable accent (`--green`, default Xbox green) on focus borders and CTAs.

Primary surfaces:

```
Page (#101010) → tiles (#202020) → controls (#252525) → panels (#1f1f1f / #151515)
Accent: #107C10 (user-selectable from 5 Microsoft/Xbox slots)
Type: Segoe UI
Tiles: 280×387 reference art, cropped to visible cover ratio
```

## View modes

| Body class | What the user sees |
|------------|-------------------|
| *(default)* | Browse page — hero, featured row, genre rail, infinite grid |
| `browse-mode-dlc` | Add-ons pivot — package-type rail, list-style addon cards |
| `game-view` | Full-page game detail (`#gamePage`) |
| `profile-view` | Profile hub (`#profilePage`) |

Overlays (`.overlay.show`) stack above browse: preferences, auth, account settings, download picker, package picker, collection editor, media lightbox.

## Quick reference

```
Layout max-width:     1600px (--page-max)
Page padding:         60px horizontal (--page-x), 18px on mobile
Tile min width:       280px (--t-w) in auto-fill grid
Cover crop:           37px top strip hidden (--cover-crop-top); canvas crop in JS when CORS allows
Primary focus:        2px --green border or 4px pivot underline
Catalog loading:      Infinite scroll + "Showing N of M" status (not page numbers)
Font Awesome:         v7 solid icons for chrome
```

## When to update this folder

Update when you change:

- `:root` tokens or `THEME_COLORS` in `src/main.ts`
- Tile/cover dimensions or crop behavior
- Browse layout (hero, filter drawer, grid vs addon list)
- Game page, profile hub, or modal shell structure
- Breakpoints (primary: `max-width: 900px`, secondary: `520px` for genre chips)
- Motion / reveal / reduced-motion behavior
