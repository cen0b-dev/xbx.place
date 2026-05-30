import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSlugMap, gamePath } from "./slug-utils.mjs";

const ROOT = process.cwd();
const MASTER_INDEX = path.join(ROOT, "public", "master_index.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const GENRE_DIR = path.join(PUBLIC_DIR, "genre");
const GAME_DIR = path.join(PUBLIC_DIR, "game");
const BASE = "https://xbx.place";
const DEFAULT_OG_IMAGE = `${BASE}/og-image.png`;

const GENRE_FILTERS = [
  { slug: "action", label: "Action", match: ["Action & Adventure"] },
  { slug: "shooter", label: "Shooter", match: ["Shooter"] },
  { slug: "rpg", label: "RPG", match: ["Role Playing"] },
  { slug: "racing", label: "Racing", match: ["Racing & Flying"] },
  { slug: "sports", label: "Sports", match: ["Sports & Recreation", "Sports"] },
  { slug: "fighting", label: "Fighting", match: ["Fighting"] },
  { slug: "strategy", label: "Strategy", match: ["Strategy & Simulation"] },
  { slug: "family", label: "Family", match: ["Family"] },
  { slug: "platformer", label: "Platformer", match: ["Platformer"] },
  { slug: "music", label: "Music", match: ["Music"] },
  { slug: "puzzle", label: "Puzzle", match: ["Puzzle & Trivia"] },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function coverUrl(game) {
  const coverId = game.metadata?.cover_title_id ?? game.title_id;
  if (/^[A-F0-9]{8}$/i.test(coverId)) {
    return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${coverId.toUpperCase()}/artwork/boxart.jpg`;
  }
  return DEFAULT_OG_IMAGE;
}

function breadcrumbJsonLd(items) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

function pageShell({ title, description, canonical, ogImage, jsonLd = [], body }) {
  const ldBlocks = jsonLd.map((data) => `<script type="application/ld+json">${data}</script>`).join("\n    ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="xbx.place" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${ldBlocks}
    <style>
      body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#101010;color:#e8e8e8;line-height:1.65}
      main{max-width:860px;margin:0 auto;padding:48px 20px}
      h1,h2,h3{color:#fff}
      h1{font-size:clamp(1.5rem,4vw,2rem);line-height:1.2}
      a{color:#5fdb5f}
      .site-header{max-width:860px;margin:0 auto;padding:28px 20px 0}
      .site-header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:1.15rem;font-weight:600}
      .site-header img{width:32px;height:32px;object-fit:contain;display:block}
      .lead{color:#ccc;font-size:1.02rem}
      .cta{display:inline-block;margin:20px 0;padding:12px 24px;background:#107c10;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
      .cta:hover{background:#0e6b0e}
      .stats{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}
      .stat{padding:8px 14px;border-radius:999px;background:#ffffff0a;border:1px solid #ffffff12;font-size:.85rem;color:#aaa}
      .stat strong{color:#fff}
      ul.game-list{margin:0;padding-left:20px;columns:2;column-gap:24px}
      ul.game-list li{margin-bottom:4px}
      .meta{color:#aaa;font-size:.9rem;margin:8px 0 16px}
      .footer-links{margin-top:40px;padding-top:20px;border-top:1px solid #333;font-size:.9rem}
      .footer-links a{margin-right:16px}
      @media(max-width:600px){ul.game-list{columns:1}}
    </style>
  </head>
  <body>
    <header class="site-header">
      <a href="/"><img src="/logo.png" width="32" height="32" alt="" /><span>xbx.place</span></a>
    </header>
    <main>${body}</main>
  </body>
</html>
`;
}

function isGameEntry(entry) {
  return (
    entry.downloads.length === 0 ||
    entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM")
  );
}

function matchesGenre(entry, filter) {
  const genres = new Set((entry.genre ?? []).map((value) => value.toLowerCase()));
  return filter.match.some((value) => genres.has(value.toLowerCase()));
}

function gameScore(entry) {
  const rating = entry.rating ?? 0;
  const files = entry.downloads?.length ?? 0;
  return rating * 1000 + Math.min(files, 99);
}

function formatRating(rating) {
  if (rating == null) return "";
  return `${Number(rating).toFixed(2)}★`;
}

function faqJsonLd(questions) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  });
}

function gameListItems(games, slugById, limit = 50) {
  return games
    .slice(0, limit)
    .map((game) => {
      const slug = slugById[String(game.title_id).toUpperCase()] ?? game.title_id;
      return `<li><a href="${gamePath(slug)}">${escapeHtml(game.name)}</a>${game.rating != null ? ` <span class="meta">(${formatRating(game.rating)})</span>` : ""}</li>`;
    })
    .join("\n        ");
}

function renderGenrePage(filter, games, slugById) {
  const count = games.length;
  const title = `Xbox 360 ${filter.label} ROMs — Free Download | xbx.place`;
  const description = `Download ${count} Xbox 360 ${filter.label.toLowerCase()} ROMs and ISOs free. Browse ${filter.label} games with ratings, cover art, and Xenia-compatible formats.`;
  const canonical = `${BASE}/genre/${filter.slug}/`;
  const body = `
      <h1>Xbox 360 ${escapeHtml(filter.label)} ROMs</h1>
      <p class="lead">
        Browse ${count.toLocaleString()} Xbox 360 ${escapeHtml(filter.label.toLowerCase())} ROMs and ISOs —
        searchable, free to download, with community ratings and Redump-aligned metadata.
      </p>
      <div class="stats">
        <span class="stat"><strong>${count.toLocaleString()}</strong> ${escapeHtml(filter.label.toLowerCase())} titles</span>
        <span class="stat"><strong>ISO & XEX</strong> formats</span>
        <span class="stat"><strong>Xenia</strong> compatible</span>
      </div>
      <a class="cta" href="/genre/${encodeURIComponent(filter.slug)}/">Open interactive ${escapeHtml(filter.label.toLowerCase())} catalog</a>
      <h2>Top ${escapeHtml(filter.label)} Xbox 360 Games</h2>
      <ul class="game-list">
        ${gameListItems(games, slugById)}
      </ul>
      <h2>FAQ</h2>
      <dl>
        <dt>Where can I download Xbox 360 ${escapeHtml(filter.label.toLowerCase())} ROMs?</dt>
        <dd>xbx.place lists ${count.toLocaleString()} ${escapeHtml(filter.label.toLowerCase())} titles with ISO, XEX, and GOD formats, cover art, and community ratings — free to browse and download.</dd>
        <dt>Are these ${escapeHtml(filter.label.toLowerCase())} ROMs compatible with Xenia?</dt>
        <dd>Most Xbox 360 ISO and XEX dumps in our catalog work with the <a href="https://xenia-emulator.com/">Xenia emulator</a>. Check each title page for available file formats.</dd>
      </dl>
      <p><a href="/xbox-360-roms.html">All Xbox 360 ROMs</a> · <a href="/">Full catalog</a></p>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/about.html">About</a>
        <a href="/press.html">Press</a>
      </div>`;
  return pageShell({
    title,
    description,
    canonical,
    ogImage: DEFAULT_OG_IMAGE,
    jsonLd: [
      breadcrumbJsonLd([
        { name: "xbx.place", url: `${BASE}/` },
        { name: "Xbox 360 ROMs", url: `${BASE}/xbox-360-roms.html` },
        { name: `${filter.label} ROMs`, url: canonical },
      ]),
      faqJsonLd([
        {
          q: `Where can I download Xbox 360 ${filter.label.toLowerCase()} ROMs?`,
          a: `xbx.place lists ${count} ${filter.label.toLowerCase()} Xbox 360 titles with ISO, XEX, and GOD formats, cover art, and community ratings.`,
        },
        {
          q: `Are Xbox 360 ${filter.label.toLowerCase()} ROMs compatible with Xenia?`,
          a: "Most ISO and XEX dumps in our catalog work with the Xenia Xbox 360 emulator. Check each title page for available formats.",
        },
      ]),
    ],
    body,
  });
}

function renderGamePage(game, slug) {
  const title = `${game.name} Xbox 360 ROM Download | xbx.place`;
  const description =
    game.description?.trim() ||
    `Download ${game.name} for Xbox 360 — ROM, ISO, and XEX files with metadata, ratings, and cover art on xbx.place.`;
  const canonical = `${BASE}${gamePath(slug)}`;
  const ogImage = coverUrl(game);
  const genres = (game.genre ?? []).slice(0, 4).join(", ");
  const regions = (game.regions ?? []).slice(0, 4).join(", ");
  const fileCount = game.downloads?.length ?? 0;
  const body = `
      <h1>${escapeHtml(game.name)}</h1>
      <p class="meta">Xbox 360 ROM · ${fileCount} downloadable file${fileCount === 1 ? "" : "s"}${game.rating != null ? ` · ${formatRating(game.rating)} community rating` : ""}</p>
      <p class="lead">${escapeHtml(description.slice(0, 320))}${description.length > 320 ? "…" : ""}</p>
      <div class="stats">
        ${game.developer ? `<span class="stat"><strong>Developer:</strong> ${escapeHtml(game.developer)}</span>` : ""}
        ${game.publisher ? `<span class="stat"><strong>Publisher:</strong> ${escapeHtml(game.publisher)}</span>` : ""}
        ${game.release_date ? `<span class="stat"><strong>Released:</strong> ${escapeHtml(String(game.release_date))}</span>` : ""}
        ${genres ? `<span class="stat"><strong>Genre:</strong> ${escapeHtml(genres)}</span>` : ""}
        ${regions ? `<span class="stat"><strong>Region:</strong> ${escapeHtml(regions)}</span>` : ""}
      </div>
      <a class="cta" href="${gamePath(slug)}">Download ${escapeHtml(game.name)}</a>
      <h2>FAQ</h2>
      <dl>
        <dt>How do I download ${escapeHtml(game.name)} for Xbox 360?</dt>
        <dd>Open the title page on xbx.place to browse ${fileCount} downloadable file${fileCount === 1 ? "" : "s"} in ISO, XEX, or archive format. Files are free to download.</dd>
        <dt>Can I play ${escapeHtml(game.name)} on Xenia?</dt>
        <dd>Xenia supports many Xbox 360 ISO and XEX dumps. Compatibility varies by title — check the Xenia compatibility database for ${escapeHtml(game.name)}.</dd>
      </dl>
      <p>
        Open the full title page for download links, DLC, title updates, artwork, and related games.
        Files are available in ISO, XEX, and archive formats compatible with the
        <a href="https://xenia-emulator.com/">Xenia emulator</a>.
      </p>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/about.html">About</a>
      </div>`;
  return pageShell({
    title,
    description,
    canonical,
    ogImage,
    jsonLd: [
      breadcrumbJsonLd([
        { name: "xbx.place", url: `${BASE}/` },
        { name: "Xbox 360 ROMs", url: `${BASE}/xbox-360-roms.html` },
        { name: game.name, url: canonical },
      ]),
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "VideoGame",
        name: game.name,
        url: canonical,
        gamePlatform: "Xbox 360",
        description: description.slice(0, 500),
        image: ogImage,
        ...(game.rating != null
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: String(game.rating),
                bestRating: "5",
                ratingCount: "1",
              },
            }
          : {}),
      }),
      faqJsonLd([
        {
          q: `How do I download ${game.name} for Xbox 360?`,
          a: `Visit xbx.place to browse ${fileCount} downloadable files for ${game.name} in ISO, XEX, or archive format.`,
        },
        {
          q: `Can I play ${game.name} on Xenia?`,
          a: "Xenia supports many Xbox 360 ISO and XEX dumps. Compatibility varies — check the Xenia compatibility database for this title.",
        },
      ]),
    ],
    body,
  });
}

async function emptyDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map((entry) => rm(path.join(dir, entry.name), { recursive: true, force: true }))
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function main() {
  const raw = await readFile(MASTER_INDEX, "utf8");
  const titles = JSON.parse(raw);
  const { byId: slugById } = buildSlugMap(titles);
  const games = titles.filter(isGameEntry);

  await emptyDir(GENRE_DIR);
  await emptyDir(GAME_DIR);
  await mkdir(GENRE_DIR, { recursive: true });
  await mkdir(GAME_DIR, { recursive: true });

  let genrePageCount = 0;
  for (const filter of GENRE_FILTERS) {
    const genreGames = games
      .filter((game) => matchesGenre(game, filter))
      .sort((a, b) => gameScore(b) - gameScore(a));
    if (genreGames.length === 0) continue;
    const outDir = path.join(GENRE_DIR, filter.slug);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), renderGenrePage(filter, genreGames, slugById), "utf8");
    genrePageCount += 1;
  }

  for (const game of titles) {
    const titleId = String(game.title_id).toUpperCase();
    const slug = slugById[titleId];
    if (!slug) continue;
    const outDir = path.join(GAME_DIR, slug);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "index.html"), renderGamePage(game, slug), "utf8");
  }

  console.log(
    `Wrote ${genrePageCount} genre pages under public/genre/ and ${Object.keys(slugById).length} slug game pages under public/game/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
