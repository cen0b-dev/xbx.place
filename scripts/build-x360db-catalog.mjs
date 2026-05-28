import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { minervaRomUrl } from "./minerva-url.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUT_MASTER = path.join(PUBLIC_DIR, "master_index.json");
const OUTPUT_CANONICAL = path.join(DATA_DIR, "x360db-index.json");
const IA_MAP_PATH = path.join(PUBLIC_DIR, "ia-file-map.json");
const X360DB_GAMES_URL = "https://raw.githubusercontent.com/xenia-manager/x360db/main/games.json";
const X360DB_INFO_URL = "https://raw.githubusercontent.com/xenia-manager/x360db/main/titles";
const REDUMP_ONLY = process.env.X360DB_REDUMP_ONLY !== "0";
const DETAIL_BATCH_SIZE = Number.parseInt(process.env.X360DB_DETAIL_BATCH_SIZE ?? "24", 10);

function normalizeForMatch(value) {
  return value
    .toLowerCase()
    .replace(/\.(zip|iso|7z)$/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\bdisc\s*\d+\b/g, " ")
    .replace(/\bpart\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRegions(filename) {
  const matches = filename.match(/\(([^)]+)\)/g) ?? [];
  const out = new Set();
  for (const token of matches) {
    const value = token.slice(1, -1).toLowerCase();
    if (value.includes("usa")) out.add("USA");
    if (value.includes("europe")) out.add("Europe");
    if (value.includes("japan")) out.add("Japan");
    if (value.includes("world")) out.add("World");
    if (value.includes("region free")) out.add("World");
  }
  return [...out];
}

async function readIaMap() {
  try {
    const raw = await readFile(IA_MAP_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    console.warn(`Missing ${IA_MAP_PATH} — run npm run build:ia-map`);
  }
  return {};
}

function buildDownloadEntry(filename, archiveUrl) {
  if (typeof archiveUrl !== "string" || !archiveUrl) return null;
  const label = filename.replace(/\.(zip|iso|7z)$/i, "");
  return {
    filename,
    label,
    url: archiveUrl,
    type: "Game",
    source: "archive.org",
    fastUrl: minervaRomUrl(filename),
    fastSource: "minerva-archive.org"
  };
}

function buildIaIndex(map) {
  const index = new Map();
  for (const [filename, archiveUrl] of Object.entries(map)) {
    if (typeof filename !== "string") continue;
    const dl = buildDownloadEntry(filename, archiveUrl);
    if (!dl) continue;
    const normalized = normalizeForMatch(filename);
    if (!normalized) continue;
    const list = index.get(normalized) ?? [];
    list.push(dl);
    index.set(normalized, list);
  }
  return index;
}

async function fetchX360dbGames() {
  const response = await fetch(X360DB_GAMES_URL, {
    headers: { "user-agent": "xbx.place x360db builder" }
  });
  if (!response.ok) throw new Error(`Failed fetching x360db games: ${response.status}`);
  const parsed = await response.json();
  if (!Array.isArray(parsed)) throw new Error("Unexpected x360db games format");
  return parsed;
}

async function fetchTitleInfo(titleId) {
  if (!titleId) return null;
  const response = await fetch(`${X360DB_INFO_URL}/${titleId}/info.json`, {
    headers: { "user-agent": "xbx.place x360db builder" }
  });
  if (!response.ok) return null;
  return response.json();
}

async function fetchTitleInfoMap(titleIds) {
  const out = new Map();
  for (let i = 0; i < titleIds.length; i += DETAIL_BATCH_SIZE) {
    const batch = titleIds.slice(i, i + DETAIL_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          return [id, await fetchTitleInfo(id)];
        } catch {
          return [id, null];
        }
      })
    );
    for (const [id, info] of results) {
      out.set(id, info);
    }
  }
  return out;
}

function mergeRegions(downloads) {
  const out = new Set();
  for (const dl of downloads) {
    for (const region of parseRegions(dl.filename)) {
      out.add(region);
    }
  }
  return [...out];
}

function coerceRating(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  const [games, iaMap] = await Promise.all([fetchX360dbGames(), readIaMap()]);
  const iaIndex = buildIaIndex(iaMap);

  const detailIds = (REDUMP_ONLY
    ? games.filter((g) => iaIndex.has(normalizeForMatch(typeof g.title === "string" ? g.title : "")))
    : games
  )
    .map((g) => (typeof g.id === "string" ? g.id : ""))
    .filter(Boolean);
  const infoById = await fetchTitleInfoMap(detailIds);

  const titles = games.map((game) => {
    const titleId = typeof game.id === "string" ? game.id : "";
    const info = infoById.get(titleId) ?? null;
    const infoTitle = info?.title?.full ?? info?.title?.reduced ?? null;
    const name = typeof game.title === "string" ? game.title : infoTitle || "Unknown Title";
    const normalized = normalizeForMatch(name);
    const downloads = iaIndex.get(normalized) ?? [];
    const regions = mergeRegions(downloads);
    return {
      title_id: titleId,
      name,
      description: info?.description?.short ?? info?.description?.full ?? "Metadata from x360db.",
      developer: info?.developer ?? undefined,
      publisher: info?.publisher ?? undefined,
      release_date: info?.release_date ?? null,
      rating: coerceRating(info?.user_rating),
      regions,
      genre: Array.isArray(info?.genre) ? info.genre : [],
      artwork: Array.isArray(info?.artwork?.gallery) ? { gallery: info.artwork.gallery } : undefined,
      downloads,
      metadata: { source: "x360db" }
    };
  });

  const filteredTitles = REDUMP_ONLY ? titles.filter((t) => t.downloads.length > 0) : titles;

  const canonical = {
    generatedAt: new Date().toISOString(),
    source: "x360db + ia-file-map (archive.org) + minerva-archive.org rom pages",
    totalTitles: filteredTitles.length,
    titlesWithDownloads: titles.filter((t) => t.downloads.length > 0).length,
    titlesWithRatings: filteredTitles.filter((t) => typeof t.rating === "number").length,
    redumpOnly: REDUMP_ONLY,
    titles: filteredTitles
  };

  await writeFile(OUTPUT_MASTER, `${JSON.stringify(filteredTitles, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_CANONICAL, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${filteredTitles.length} titles (${canonical.titlesWithDownloads} with Archive + MiNERVA links, redumpOnly=${REDUMP_ONLY})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
