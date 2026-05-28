# LegionGamesGod tools

Fast, no-browser utilities for [legiongamesgod.com](https://legiongamesgod.com) Xbox 360 listings.

## Scan Xbox 360 catalog

```bash
npm run legion:scan
```

Crawls every `/xbox-360/{letter}/` page (plus `533-2`, `k-2`, etc.) with pagination, in parallel. Typical runtime: **~15–25 s** for ~790 games.

### Options

| Flag | Description |
|------|-------------|
| `--sitemap` | Also pull `wp-sitemap-posts-post-1.xml` (~1900 site-wide `/juegos/` URLs, includes DLC) |
| `--hosts` | Sample game post pages and count download hosts (MediaFire, Google Sites, …) |
| `--hosts-sample=80` | Pages to check with `--hosts` |
| `--concurrency=32` | Parallel requests |
| `-q` | Machine-readable one-line summary |

### Output

| File | Contents |
|------|----------|
| `output/xbox360-games.json` | Sorted game post URLs + count |
| `output/scan-summary.json` | Counts, timing, optional host breakdown |

`output/` is gitignored; regenerate anytime.

## Notes

- **Xbox 360 section** (~789 titles): discovered from `/xbox-360/` index pages only.
- **WordPress sitemap** (~1903 posts): ~789 under `/juegos/` (matches Xbox 360 listing); rest are Xbox Clásico, XBLA, etc.
- Download links on game pages are usually **Google Sites** (`sites.google.com/view/legiongamesgodrgh/…`), not MediaFire. Use `--hosts` to verify on a sample.
