# xbx.place Design System

Design documentation for **xbx.place**, a catalog UI that blends **Microsoft Metro** (content-first, typographic, flat) with **Xbox console shell** patterns from the **Xbox One dashboard era** and the **rounded, layered Xbox Series X|S UI**.

This folder is the source of truth for visual language, component behavior, and implementation tokens. Primary implementation lives in `src/styles.css` and `src/main.ts`.

## Documents

| Document | Contents |
|----------|----------|
| [Foundations](./foundations.md) | Color, type, spacing, radius, elevation, grid, motion tokens |
| [Components](./components.md) | Header, tiles, blades, shelves, modals, controls, footer |
| [Motifs & Interactions](./motifs-and-interactions.md) | Xbox/Metro lineage, focus states, dimming, scroll, responsive rules |
| [Tokens](./tokens.css) | CSS custom properties reference (copy-paste friendly) |

## Design intent (one paragraph)

The interface should feel like browsing a **modern Xbox library** on a dark living-room display: large cover art, horizontal discovery rows, pivot navigation, and **blade panels** that slide into focus. Unlike the original flat Win8/Xbox One Metro (hard 90° corners, pure flat rectangles), xbx.place uses **softened Metro** — rounded tiles, subtle depth, glassy sticky chrome, and accent-driven focus rings — closer to **Fluent Design** and the **Series X|S Home** refresh while keeping the **green Xbox accent**, uppercase section labels, and **content tile grid** that defined the One era.

## Quick reference

```
Background stack:   #101010 → #202020 tiles → #252525 inputs/panels
Accent (default):   #107C10 (Xbox green)
Typeface:           Segoe UI (Microsoft system UI)
Corner radii:       8px / 12px / 16px (sm / md / lg)
Primary motif:      Cover-forward tiles + green focus border + blade overlay
```

## When to update this folder

Update design docs when you change:

- CSS variables in `:root` or theme picker colors in `THEME_COLORS`
- Tile dimensions (`--t-w`, `--t-h`, `--cover-crop-top`)
- Blade/shelf/modal structure or animation timing
- Breakpoints or sticky header behavior
