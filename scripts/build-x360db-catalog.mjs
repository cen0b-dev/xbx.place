import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { minervaRomUrl } from "./minerva-url.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUT_MASTER = path.join(PUBLIC_DIR, "master_index.json");
const OUTPUT_CANONICAL = path.join(DATA_DIR, "x360db-index.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "dlc-parent-overrides.json");
const GAME_ROM_OVERRIDES_PATH = path.join(DATA_DIR, "game-rom-overrides.json");
const UNMATCHED_REPORT_PATH = path.join(DATA_DIR, "dlc-unmatched-report.json");
const IA_MAP_PATH = path.join(PUBLIC_DIR, "ia-file-map.json");
const X360DB_GAMES_URL = "https://raw.githubusercontent.com/xenia-manager/x360db/main/games.json";
const X360DB_INFO_URL = "https://raw.githubusercontent.com/xenia-manager/x360db/main/titles";
const REDUMP_ONLY = process.env.X360DB_REDUMP_ONLY !== "0";
const DETAIL_BATCH_SIZE = Number.parseInt(process.env.X360DB_DETAIL_BATCH_SIZE ?? "24", 10);
const DLC_ARCHIVE_RE = /\/XBOX_360_DLC_\d+\//i;
const TU_ARCHIVE_RE = /\/microsoft_xbox360_title-updates\//i;

const TOKEN_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "vs",
  "for",
  "in",
  "on",
  "at",
  "to",
  "s",
  "x",
  "360",
  "edition",
  "world",
  "usa",
  "europe",
  "japan",
  "en",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "pl",
  "ru",
  "title",
  "update",
  "dlc"
]);

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function foldUnicode(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function romanToArabic(value) {
  return value
    .replace(/\bii\b/gi, "2")
    .replace(/\biii\b/gi, "3")
    .replace(/\biv\b/gi, "4")
    .replace(/\bvi\b/gi, "6")
    .replace(/\bvii\b/gi, "7")
    .replace(/\bviii\b/gi, "8")
    .replace(/\bix\b/gi, "9")
    .replace(/\bx\b/gi, "10")
    .replace(/\bxi\b/gi, "11")
    .replace(/\bxii\b/gi, "12");
}

function normalizeForMatch(value) {
  return romanToArabic(foldUnicode(decodeHtmlEntities(value)))
    .toLowerCase()
    .replace(/\.(zip|iso|7z)$/g, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\bdisc\s*\d+\b/g, " ")
    .replace(/\bpart\s*\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(value) {
  return decodeHtmlEntities(value).trim();
}

async function loadOverrideMap(filePath, label) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const overrides = parsed?.overrides;
    if (!overrides || typeof overrides !== "object") return new Map();
    const out = new Map();
    for (const [key, titleId] of Object.entries(overrides)) {
      if (key.startsWith("_") || typeof titleId !== "string" || !titleId) continue;
      out.set(normalizeForMatch(key), titleId.toUpperCase());
    }
    return out;
  } catch {
    console.warn(`Missing ${filePath} — no ${label} overrides loaded`);
    return new Map();
  }
}

async function loadParentOverrides() {
  const [dlc, gameRom] = await Promise.all([
    loadOverrideMap(OVERRIDES_PATH, "DLC parent"),
    loadOverrideMap(GAME_ROM_OVERRIDES_PATH, "game ROM")
  ]);
  return new Map([...dlc, ...gameRom]);
}

function stripRedumpLabel(filename) {
  let base = displayName(filename.replace(/\.(zip|iso|7z)$/i, ""));
  for (let i = 0; i < 5; i += 1) {
    const next = base
      .replace(
        /\s*\((USA(?:[^)]*)?|Europe(?:[^)]*)?|Japan|World|Australia(?:[^)]*)?|Asia|Brazil|Korea|Russia|Scandinavia|Region Free|[A-Za-z]{2}(?:,[A-Za-z]{2})*|En[^)]*|Demo|Beta[^)]*|Rev[^)]*|Toys R Us[^)]*)\)\s*$/gi,
        ""
      )
      .trim();
    if (next === base) break;
    base = next;
  }
  return base.trim();
}

function expandRedumpTitleVariants(value) {
  const variants = [value];
  const commaTheDash = value.match(/^(.+?),\s*The\s*-\s*(.+)$/i);
  if (commaTheDash?.[1] && commaTheDash[2]) {
    const series = commaTheDash[1].trim();
    const subtitle = commaTheDash[2].trim();
    variants.push(`The ${series} - ${subtitle}`);
    variants.push(`The ${series}: ${subtitle}`);
    variants.push(`${series}: ${subtitle}`);
  }
  const dashCommaThe = value.match(/^(.+?)\s*-\s*(.+?),\s*The$/i);
  if (dashCommaThe?.[1] && dashCommaThe[2]) {
    const series = dashCommaThe[1].trim();
    const subtitle = dashCommaThe[2].trim();
    variants.push(`The ${series}: ${subtitle}`);
    variants.push(`The ${series} - ${subtitle}`);
    variants.push(`${series}: ${subtitle}`);
  }
  const commaTheOnly = value.match(/^(.+?),\s*The$/i);
  if (commaTheOnly?.[1]) {
    variants.push(`The ${commaTheOnly[1].trim()}`);
  }

  const bond = value.match(/^007\s*-\s*(.+)$/i);
  if (bond?.[1]) variants.push(`James Bond 007: ${bond[1].trim()}`);

  const tilde = value.match(/^(.+?)\s*~\s*(.+)$/);
  if (tilde?.[1]) {
    variants.push(tilde[1].trim());
    variants.push(tilde[2].trim());
  }

  const disneyPixar = value.match(/^Disney-Pixar\s+(.+)$/i);
  if (disneyPixar?.[1]) {
    variants.push(disneyPixar[1].trim());
    variants.push(`Disney ${disneyPixar[1].trim()}`);
  }
  const disney = value.match(/^Disney\s+(.+)$/i);
  if (disney?.[1]) variants.push(disney[1].trim());

  const dreamworks = value.match(/^DreamWorks\s+(.+)$/i);
  if (dreamworks?.[1]) variants.push(dreamworks[1].trim());

  const dashParts = value.split(/\s+-\s+/);
  if (dashParts.length > 1) variants.push(dashParts[0].trim());

  for (const pattern of [
    /\s*-\s*Game of the Year Edition?.*$/i,
    /\s*-\s*GOTY\b.*$/i,
    /\s*-\s*Ultimate Edition?.*$/i,
    /\s*-\s*Legendary Edition?.*$/i,
    /\s*-\s*Director's Cut.*$/i,
    /\s*-\s*Legacy Edition?.*$/i,
    /\s*-\s*Complete Edition?.*$/i,
    /\s*-\s*Complete Coaching.*$/i,
    /\s*-\s*The Game$/i,
    /\s*-\s*The Videogame$/i,
    /\s*-\s*Ego Draconis$/i,
    /\s*-\s*Unveiled Edition.*$/i,
    /!\s*$/
  ]) {
    const stripped = value.replace(pattern, "").trim();
    if (stripped && stripped !== value) variants.push(stripped);
  }

  if (value.includes(" - ")) variants.push(value.replace(/\s+-\s+/g, ": "));
  if (value.includes(": ")) variants.push(value.replace(/:\s+/g, " - "));

  return [...new Set(variants.filter(Boolean))];
}

function titleMatchKeys(value, parentOverrides) {
  const keys = new Set();
  for (const variant of expandRedumpTitleVariants(value)) {
    const normalized = normalizeForMatch(variant);
    if (!normalized) continue;
    keys.add(normalized);

    const overrideId = parentOverrides.get(normalized);
    if (overrideId) keys.add(`__id__:${overrideId}`);

    const commaThe = normalized.match(/^(.+?) the$/);
    if (commaThe?.[1]) keys.add(`the ${commaThe[1].trim()}`);
    const leadingThe = normalized.match(/^the (.+)$/);
    if (leadingThe?.[1]) {
      keys.add(`${leadingThe[1].trim()} the`);
      keys.add(leadingThe[1].trim());
    }
  }
  return [...keys];
}

function significantTokens(value) {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length > 1 && !TOKEN_STOP_WORDS.has(token));
}

function tokenOverlapScore(source, target) {
  const sourceTokens = significantTokens(source);
  const targetTokens = significantTokens(target);
  if (!sourceTokens.length || !targetTokens.length) return 0;
  const targetSet = new Set(targetTokens);
  let hits = 0;
  for (const token of sourceTokens) {
    if (targetSet.has(token)) hits += 1;
    else if ([...targetSet].some((candidate) => candidate.startsWith(token) || token.startsWith(candidate))) {
      hits += 0.5;
    }
  }
  return hits / sourceTokens.length;
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

function parseUpdateVersion(filename) {
  const match = filename.match(/\(v(\d+(?:\.\d+)?)(?:\s+\d+)?([a-z])?\)/i);
  if (!match?.[1]) return undefined;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const letter = match[2] ? (match[2].toLowerCase().charCodeAt(0) - 96) * 0.001 : 0;
  return base + letter;
}

function buildDownloadEntry(filename, archiveUrl, type = "Game") {
  if (typeof archiveUrl !== "string" || !archiveUrl) return null;
  const label = displayName(filename.replace(/\.(zip|iso|7z)$/i, ""));
  const isRedump = !DLC_ARCHIVE_RE.test(archiveUrl) && !TU_ARCHIVE_RE.test(archiveUrl);
  const updateVersion = type === "Update" ? parseUpdateVersion(filename) : undefined;
  return {
    filename,
    label,
    url: archiveUrl,
    type,
    source: "archive.org",
    ...(updateVersion !== undefined ? { updateVersion } : {}),
    ...(isRedump
      ? { fastUrl: minervaRomUrl(filename), fastSource: "minerva-archive.org" }
      : {})
  };
}

function isDlcFilename(filename, archiveUrl) {
  if (TU_ARCHIVE_RE.test(archiveUrl)) return false;
  if (DLC_ARCHIVE_RE.test(archiveUrl)) return true;
  if (/\((Addon|Update)\)/i.test(filename)) return true;
  if (/\bDLC\b/i.test(filename) && /\((Install Disc|DLC Installer)\)/i.test(filename)) return true;
  return false;
}

function downloadType(filename, archiveUrl) {
  if (TU_ARCHIVE_RE.test(archiveUrl)) return "Update";
  if (/\(Update\)/i.test(filename)) return "Update";
  if (isDlcFilename(filename, archiveUrl)) return "DLC";
  return "Game";
}

function stripDlcDecorations(filename) {
  let base = displayName(filename.replace(/\.(zip|iso|7z)$/i, ""));
  base = base.replace(/\s*\((Addon|DLC|Update)\)\s*$/gi, "").trim();
  base = base.replace(/\s*\(v\d+(?:\.\d+)?(?:\s+\d+)?[a-z]?\)\s*/gi, " ").trim();
  base = base.replace(/\s*\((Alt(?:\s+\d+)?|UK|LV)\)\s*/gi, " ").trim();
  base = base.replace(/\s*\([0-9A-F]{8}\)\s*/gi, " ").trim();
  for (let i = 0; i < 4; i += 1) {
    const next = base
      .replace(
        /\s*\((USA(?:[^)]*)?|Europe(?:[^)]*)?|Japan|World|Australia(?:[^)]*)?|Region Free|[A-Za-z]{2}(?:,[A-Za-z]{2})*)\)\s*$/gi,
        ""
      )
      .trim();
    if (next === base) break;
    base = next;
  }
  return base.trim();
}

function dlcMatchCandidates(filename, parentOverrides) {
  const stripped = stripDlcDecorations(filename);
  const parts = stripped.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  const candidates = [];
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 1) {
      for (const key of titleMatchKeys(parts.slice(0, i).join(" "), parentOverrides)) {
        candidates.push(key);
      }
    }
  }
  for (const key of titleMatchKeys(stripped, parentOverrides)) candidates.push(key);
  for (const key of titleMatchKeys(parts[0] ?? stripped, parentOverrides)) candidates.push(key);
  return [...new Set(candidates.filter(Boolean))];
}

function syntheticTitleId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `DLC${hash.toString(16).padStart(8, "0").slice(-8).toUpperCase()}`;
}

function buildIaIndex(map, parentOverrides) {
  const gameIndex = new Map();
  const dlcEntries = [];

  for (const [filename, archiveUrl] of Object.entries(map)) {
    if (typeof filename !== "string") continue;
    const type = downloadType(filename, archiveUrl);
    const dl = buildDownloadEntry(filename, archiveUrl, type);
    if (!dl) continue;

    if (type === "DLC" || type === "Update") {
      dlcEntries.push(dl);
      continue;
    }

    if (!normalizeForMatch(filename)) continue;
    const redumpLabel = stripRedumpLabel(filename);
    for (const key of titleMatchKeys(redumpLabel, parentOverrides)) {
      const list = gameIndex.get(key) ?? [];
      list.push(dl);
      gameIndex.set(key, list);
    }
  }

  return { gameIndex, dlcEntries };
}

function buildNameIndex(titles, parentOverrides) {
  const byName = new Map();
  for (const title of titles) {
    for (const key of titleMatchKeys(title.name, parentOverrides)) {
      if (!key || byName.has(key)) continue;
      byName.set(key, title);
    }
    byName.set(`__id__:${title.title_id.toUpperCase()}`, title);
  }
  return byName;
}

function resolveOverrideCandidate(candidate, titleById, parentOverrides) {
  if (candidate.startsWith("__id__:")) {
    return titleById.get(candidate.slice(7)) ?? null;
  }
  const titleId = parentOverrides.get(candidate);
  if (titleId) return titleById.get(titleId) ?? null;
  return null;
}

function findTitleForDlc(filename, nameIndex, titlesByLength, titleById, parentOverrides) {
  const candidates = dlcMatchCandidates(filename, parentOverrides);

  for (const candidate of candidates) {
    const exact = nameIndex.get(candidate);
    if (exact) return exact;
    const overrideMatch = resolveOverrideCandidate(candidate, titleById, parentOverrides);
    if (overrideMatch) return overrideMatch;
  }

  for (const candidate of candidates) {
    for (const title of titlesByLength) {
      for (const gameKey of titleMatchKeys(title.name, parentOverrides)) {
        if (candidate.startsWith("__id__:")) continue;
        if (candidate.startsWith(`${gameKey} `) || candidate === gameKey) return title;
        if (gameKey.startsWith(`${candidate} `) || gameKey.startsWith(candidate)) return title;
      }
    }
  }

  const parentLabel = stripDlcDecorations(filename).split(/\s*-\s*/)[0]?.trim();
  if (parentLabel) {
    const parentKey = normalizeForMatch(parentLabel);
    const overrideMatch = resolveOverrideCandidate(parentKey, titleById, parentOverrides);
    if (overrideMatch) return overrideMatch;

    const parentTokens = significantTokens(parentLabel);
    let best = null;
    let bestScore = 0;
    for (const title of titlesByLength) {
      const score = tokenOverlapScore(parentLabel, title.name);
      const minScore =
        parentTokens.length <= 1 ? 1 : parentTokens.length <= 2 ? 0.95 : 0.75;
      if (score < minScore || score <= bestScore) continue;

      const targetTokens = significantTokens(title.name);
      const exactHits = parentTokens.filter((token) => targetTokens.includes(token)).length;
      const sourceNorm = normalizeForMatch(parentLabel);
      const targetNorm = normalizeForMatch(title.name);
      const contiguous =
        targetNorm.startsWith(`${sourceNorm} `) ||
        targetNorm.startsWith(sourceNorm) ||
        sourceNorm.startsWith(`${targetNorm} `) ||
        sourceNorm.startsWith(targetNorm);
      if (parentTokens.length <= 2 && !contiguous && exactHits < parentTokens.length) continue;

      best = title;
      bestScore = score;
    }
    if (best) return best;
  }

  return null;
}

function attachDlcDownloads(titles, dlcEntries, parentOverrides) {
  const nameIndex = buildNameIndex(titles, parentOverrides);
  const titlesByLength = [...titles].sort(
    (a, b) => normalizeForMatch(b.name).length - normalizeForMatch(a.name).length
  );
  const titleById = new Map(titles.map((title) => [title.title_id.toUpperCase(), title]));
  const unmatched = new Map();
  let matched = 0;

  for (const dl of dlcEntries) {
    const match = findTitleForDlc(dl.filename, nameIndex, titlesByLength, titleById, parentOverrides);
    if (match) {
      const existing = titleById.get(match.title_id.toUpperCase());
      if (existing && !existing.downloads.some((entry) => entry.filename === dl.filename)) {
        existing.downloads.push(dl);
        matched += 1;
      }
      continue;
    }

    const parentLabel = stripDlcDecorations(dl.filename).split(/\s*-\s*/)[0]?.trim() || dl.label;
    const orphanKey = titleMatchKeys(parentLabel, parentOverrides)[0] ?? normalizeForMatch(dl.filename);
    const bucket = unmatched.get(orphanKey) ?? {
      name: displayName(parentLabel),
      downloads: []
    };
    bucket.downloads.push(dl);
    unmatched.set(orphanKey, bucket);
  }

  const orphanTitles = [...unmatched.values()].map((bucket) => ({
    title_id: syntheticTitleId(bucket.name),
    name: bucket.name,
    description: "Downloadable content from Internet Archive (parent game not matched in x360db).",
    release_date: null,
    rating: null,
    regions: mergeRegions(bucket.downloads),
    genre: [],
    downloads: bucket.downloads,
    metadata: { source: "ia-dlc", match_status: "unmatched" }
  }));

  return { matched, orphanTitles };
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

  const parentOverrides = await loadParentOverrides();
  const [games, iaMap] = await Promise.all([fetchX360dbGames(), readIaMap()]);
  const { gameIndex, dlcEntries } = buildIaIndex(iaMap, parentOverrides);

  const detailIds = (REDUMP_ONLY
    ? games.filter((g) => {
        const title = typeof g.title === "string" ? g.title : "";
        const titleId = typeof g.id === "string" ? g.id.toUpperCase() : "";
        return [...titleMatchKeys(title, parentOverrides), `__id__:${titleId}`].some((key) =>
          gameIndex.has(key)
        );
      })
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
    const downloads = [];
    const seenFilenames = new Set();
    const matchKeys = [...titleMatchKeys(name, parentOverrides), `__id__:${titleId.toUpperCase()}`];
    for (const key of matchKeys) {
      for (const dl of gameIndex.get(key) ?? []) {
        if (seenFilenames.has(dl.filename)) continue;
        seenFilenames.add(dl.filename);
        downloads.push(dl);
      }
    }
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

  const { matched: dlcMatched, orphanTitles } = attachDlcDownloads(titles, dlcEntries, parentOverrides);
  const allTitles = [...titles, ...orphanTitles];

  const filteredTitles = REDUMP_ONLY ? allTitles.filter((t) => t.downloads.length > 0) : allTitles;

  const titlesWithDlc = filteredTitles.filter((t) =>
    t.downloads.some((d) => d.type === "DLC" || d.type === "Update")
  ).length;

  const unmatchedReport = {
    generatedAt: new Date().toISOString(),
    orphanBuckets: orphanTitles.length,
    orphanFiles: orphanTitles.reduce((sum, entry) => sum + entry.downloads.length, 0),
    buckets: orphanTitles.map((entry) => ({
      name: entry.name,
      title_id: entry.title_id,
      fileCount: entry.downloads.length,
      sampleFilenames: entry.downloads.slice(0, 3).map((dl) => dl.filename)
    }))
  };

  const canonical = {
    generatedAt: new Date().toISOString(),
    source: "x360db + ia-file-map (archive.org redump + XBOX_360_DLC + title updates) + minerva-archive.org rom pages",
    totalTitles: filteredTitles.length,
    titlesWithDownloads: allTitles.filter((t) => t.downloads.length > 0).length,
    titlesWithDlc,
    dlcFiles: dlcEntries.length,
    dlcMatchedToGames: dlcMatched,
    dlcOrphanTitles: orphanTitles.length,
    dlcParentOverrides: parentOverrides.size,
    titlesWithRatings: filteredTitles.filter((t) => typeof t.rating === "number").length,
    redumpOnly: REDUMP_ONLY,
    titles: filteredTitles
  };

  await writeFile(OUTPUT_MASTER, `${JSON.stringify(filteredTitles, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_CANONICAL, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
  await writeFile(UNMATCHED_REPORT_PATH, `${JSON.stringify(unmatchedReport, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${filteredTitles.length} titles (${canonical.titlesWithDownloads} with downloads, ${titlesWithDlc} with DLC, ${dlcMatched}/${dlcEntries.length} DLC matched, ${orphanTitles.length} orphan buckets, redumpOnly=${REDUMP_ONLY})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
