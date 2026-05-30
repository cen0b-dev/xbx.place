import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSlugMap } from "./slug-utils.mjs";
import { topGames } from "./top-games-utils.mjs";

const ROOT = process.cwd();
const MASTER_INDEX = path.join(ROOT, "public", "master_index.json");
const INDEX_HTML = path.join(ROOT, "index.html");
const ROMS_HTML = path.join(ROOT, "public", "xbox-360-roms.html");
const TOP_GAMES_JSON = path.join(ROOT, "public", "top-xbox-360-games.json");
const LIMIT = Number(process.env.TOP_GAMES_LIMIT ?? 100);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatRating(rating) {
  if (rating == null) return "";
  return Number(rating).toFixed(2);
}

function renderHtmlList(games) {
  return games
    .map((game) => {
      const rating =
        game.rating != null
          ? ` <span class="meta">(${formatRating(game.rating)}★)</span>`
          : "";
      return `        <li><a href="${game.path}">${escapeHtml(game.name)}</a>${rating}</li>`;
    })
    .join("\n");
}

function renderItemListJsonLd(games) {
  const itemListElement = games.map((game) => {
    const item = {
      "@type": "VideoGame",
      name: game.name,
      url: game.url,
      gamePlatform: "Xbox 360",
    };
    if (game.rating != null) {
      item.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: String(game.rating),
        bestRating: "5",
        ratingCount: "1",
      };
    }
    return {
      "@type": "ListItem",
      position: game.position,
      item,
    };
  });

  const payload = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": "https://xbx.place/#top-games",
    name: "Top Rated Xbox 360 Games",
    numberOfItems: games.length,
    itemListElement,
  };

  return `    <script type="application/ld+json">\n${JSON.stringify(payload, null, 2)
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n")}\n    </script>`;
}

function replaceBetweenMarkers(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Missing markers ${startMarker} / ${endMarker}`);
  }
  const before = source.slice(0, start + startMarker.length);
  const after = source.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

async function main() {
  const titles = JSON.parse(await readFile(MASTER_INDEX, "utf8"));
  const { byId: slugById } = buildSlugMap(titles);
  const games = topGames(titles, slugById, LIMIT);

  await writeFile(
    TOP_GAMES_JSON,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), count: games.length, games }, null, 2)}\n`,
    "utf8"
  );

  const htmlList = renderHtmlList(games);
  const jsonLdBlock = renderItemListJsonLd(games);

  let indexHtml = await readFile(INDEX_HTML, "utf8");
  indexHtml = replaceBetweenMarkers(
    indexHtml,
    "<!-- TOP-GAMES-LIST:START -->",
    "<!-- TOP-GAMES-LIST:END -->",
    htmlList
  );
  indexHtml = replaceBetweenMarkers(
    indexHtml,
    "<!-- TOP-GAMES-JSONLD:START -->",
    "<!-- TOP-GAMES-JSONLD:END -->",
    jsonLdBlock
  );
  await writeFile(INDEX_HTML, indexHtml, "utf8");

  let romsHtml = await readFile(ROMS_HTML, "utf8");
  romsHtml = replaceBetweenMarkers(
    romsHtml,
    "<!-- TOP-GAMES-LIST:START -->",
    "<!-- TOP-GAMES-LIST:END -->",
    htmlList
  );
  await writeFile(ROMS_HTML, romsHtml, "utf8");

  console.log(`Wrote top ${games.length} games to index.html, xbox-360-roms.html, and public/top-xbox-360-games.json`);
  console.log(`  #1 ${games[0]?.name} → ${games[0]?.path}`);
  console.log(`  #${games.length} ${games.at(-1)?.name} → ${games.at(-1)?.path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
