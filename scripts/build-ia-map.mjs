import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIaCookieHeader, fetchIaCookiePoolFromSupabase, recordIaCookieUse } from "./ia-cookie-pool.mjs";

const ROOT = process.cwd();
const MASTER_INDEX_PATH = path.join(ROOT, "public", "master_index.json");
const OUTPUT_PATH = path.join(ROOT, "public", "ia-file-map.json");
const SOURCE_URL = "https://r-roms.github.io/Microsoft/microsoft-xbox360";
const ENV_PATH = path.join(ROOT, ".env.local");
const IDENTIFIER_LIMIT = Number.parseInt(process.env.IA_MAP_LIMIT_IDENTIFIERS ?? "0", 10);
const FILTER_TO_MASTER = process.env.IA_MAP_FILTER_TO_MASTER === "1";

function parseEnvLine(line) {
  const eqIdx = line.indexOf("=");
  if (eqIdx > 0) {
    return [line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim().replace(/^"|"$/g, "")];
  }
  return [null, null];
}

async function loadLocalEnvMap() {
  const out = new Map();
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, value] = parseEnvLine(trimmed);
      if (!key || !value) continue;
      out.set(key, value);
    }
  } catch {
    // .env.local is optional
  }
  return out;
}

function randomCookiePair(pool) {
  if (!pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? null;
}

async function loadCookiePool(envMap) {
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    envMap.get("SUPABASE_URL") ??
    process.env.VITE_SUPABASE_URL ??
    envMap.get("VITE_SUPABASE_URL");
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? envMap.get("SUPABASE_SERVICE_ROLE_KEY");
  return fetchIaCookiePoolFromSupabase(supabaseUrl, serviceKey);
}

function extractRedumpIaIdentifiers(markdown) {
  const ids = new Set();
  const allMatches = markdown.matchAll(/https:\/\/archive\.org\/download\/([A-Za-z0-9%._-]+)/gi);
  for (const match of allMatches) {
    const raw = match[1];
    if (!raw) continue;
    const id = decodeURIComponent(raw);
    // Keep only redump A-Z/# buckets, skip digital/title updates/XBLA/etc.
    if (!/^microsoft_xbox360_(numberssymbols|[a-z](?:_part\d+)?)$/i.test(id)) continue;
    ids.add(id);
  }
  return [...ids];
}

function extractDlcIaIdentifiers(markdown) {
  const ids = new Set();
  const allMatches = markdown.matchAll(/https:\/\/archive\.org\/download\/([A-Za-z0-9%._-]+)/gi);
  for (const match of allMatches) {
    const raw = match[1];
    if (!raw) continue;
    const id = decodeURIComponent(raw);
    if (!/^XBOX_360_DLC_\d+$/i.test(id)) continue;
    ids.add(id);
  }
  return [...ids].sort((a, b) => {
    const ai = Number.parseInt(a.match(/\d+$/)?.[0] ?? "0", 10);
    const bi = Number.parseInt(b.match(/\d+$/)?.[0] ?? "0", 10);
    return ai - bi;
  });
}

function extractTitleUpdateIaIdentifiers(markdown) {
  const ids = new Set();
  const allMatches = markdown.matchAll(/https:\/\/archive\.org\/download\/([A-Za-z0-9%._-]+)/gi);
  for (const match of allMatches) {
    const raw = match[1];
    if (!raw) continue;
    const id = decodeURIComponent(raw);
    if (!/^microsoft_xbox360_title-updates$/i.test(id)) continue;
    ids.add(id);
  }
  return [...ids];
}

function extractXblaIaIdentifiers(markdown) {
  const ids = new Set();
  const allMatches = markdown.matchAll(/https:\/\/archive\.org\/download\/([A-Za-z0-9%._-]+)/gi);
  for (const match of allMatches) {
    const raw = match[1];
    if (!raw) continue;
    const id = decodeURIComponent(raw);
    if (!/^XBOX_360_XBLA(?:_DLC)?$/i.test(id)) continue;
    ids.add(id);
  }
  return [...ids].sort((a, b) => {
    if (/^XBOX_360_XBLA$/i.test(a)) return -1;
    if (/^XBOX_360_XBLA$/i.test(b)) return 1;
    return a.localeCompare(b);
  });
}

async function fetchJson(url, cookieHeader) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "xbx.place map builder",
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

async function main() {
  const envMap = await loadLocalEnvMap();
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    envMap.get("SUPABASE_URL") ??
    process.env.VITE_SUPABASE_URL ??
    envMap.get("VITE_SUPABASE_URL");
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? envMap.get("SUPABASE_SERVICE_ROLE_KEY");
  const cookiePool = await loadCookiePool(envMap);
  if (!cookiePool.length) {
    throw new Error(
      "No IA cookies in Supabase ia_cookie_pool. Run npm run ia-cookies to add browser cookie exports."
    );
  }

  const targetFilenames = new Set();
  if (FILTER_TO_MASTER) {
    const master = JSON.parse(await readFile(MASTER_INDEX_PATH, "utf8"));
    for (const game of master) {
      for (const dl of game.downloads ?? []) {
        if (typeof dl.filename === "string") {
          targetFilenames.add(dl.filename);
        }
      }
    }
  }

  const source = await (await fetch(SOURCE_URL)).text();
  const redumpIds = extractRedumpIaIdentifiers(source);
  const dlcIds = extractDlcIaIdentifiers(source);
  const titleUpdateIds = extractTitleUpdateIaIdentifiers(source);
  const xblaIds = extractXblaIaIdentifiers(source);
  let identifiers = [...redumpIds, ...dlcIds, ...titleUpdateIds, ...xblaIds];
  if (IDENTIFIER_LIMIT > 0) {
    identifiers = identifiers.slice(0, IDENTIFIER_LIMIT);
  }
  const map = {};
  let redumpCount = 0;
  let dlcCount = 0;
  let updateCount = 0;
  let xblaCount = 0;
  let xblaDlcCount = 0;

  for (const identifier of identifiers) {
    const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}?output=json`;
    try {
      const pair = randomCookiePair(cookiePool);
      if (pair?.id) {
        recordIaCookieUse(supabaseUrl, serviceKey, pair.id, "build");
      }
      const cookieHeader = buildIaCookieHeader(pair);
      const metadata = await fetchJson(metadataUrl, cookieHeader);
      const files = Array.isArray(metadata.files) ? metadata.files : [];
      for (const file of files) {
        const filename = file?.name;
        if (typeof filename !== "string") continue;
        if (!/\.(zip|iso|7z|rar)$/i.test(filename)) continue;
        if (FILTER_TO_MASTER && !targetFilenames.has(filename)) continue;
        if (map[filename]) continue;
        map[filename] = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodePathSegment(filename)}`;
        if (/^XBOX_360_DLC_\d+$/i.test(identifier)) dlcCount += 1;
        else if (/^microsoft_xbox360_title-updates$/i.test(identifier)) updateCount += 1;
        else if (/^XBOX_360_XBLA_DLC$/i.test(identifier)) xblaDlcCount += 1;
        else if (/^XBOX_360_XBLA$/i.test(identifier)) xblaCount += 1;
        else redumpCount += 1;
      }
      // eslint-disable-next-line no-console
      console.log(`Mapped from ${identifier}: ${Object.keys(map).length} total files`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed ${identifier}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  map["__xbx_honeypot_internal_debug__.iso"] = "__HONEYPOT__";
  map["__xbx_honeypot_catalog_probe__.zip"] = "__HONEYPOT__";
  map["__xbx_honeypot_scraper_canary__.xex"] = "__HONEYPOT__";

  await writeFile(OUTPUT_PATH, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${Object.keys(map).length} mappings (${redumpCount} redump, ${dlcCount} DLC, ${updateCount} title updates, ${xblaCount} XBLA, ${xblaDlcCount} XBLA DLC) to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
