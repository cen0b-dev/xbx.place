import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildIaCookieHeader, parseIaCookiePoolFromEnv } from "./ia-cookie-pool.mjs";

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

function resolveIaCookiePair(envMap) {
  const user = process.env.IA_LOGGED_IN_USER ?? envMap.get("IA_LOGGED_IN_USER");
  const sig = process.env.IA_LOGGED_IN_SIG ?? envMap.get("IA_LOGGED_IN_SIG");
  if (!user || !sig) {
    return null;
  }
  return { user, sig };
}

function loadCookiePoolFromEnv(envMap) {
  return parseIaCookiePoolFromEnv({
    IA_COOKIE_POOL: process.env.IA_COOKIE_POOL ?? envMap.get("IA_COOKIE_POOL"),
    IA_COOKIE_POOL_B64: process.env.IA_COOKIE_POOL_B64 ?? envMap.get("IA_COOKIE_POOL_B64"),
    IA_COOKIE_B64_ROUNDS: process.env.IA_COOKIE_B64_ROUNDS ?? envMap.get("IA_COOKIE_B64_ROUNDS"),
    IA_LOGGED_IN_USER: process.env.IA_LOGGED_IN_USER ?? envMap.get("IA_LOGGED_IN_USER"),
    IA_LOGGED_IN_SIG: process.env.IA_LOGGED_IN_SIG ?? envMap.get("IA_LOGGED_IN_SIG")
  });
}

function randomCookiePair(pool) {
  if (!pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? null;
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
  const cookiePool = loadCookiePoolFromEnv(envMap);
  const fallbackPair = resolveIaCookiePair(envMap);
  if (!cookiePool.length && !fallbackPair) {
    throw new Error(
      "Missing IA cookie credentials. Set IA_COOKIE_POOL to a JSON array [{\"user\":\"...\",\"sig\":\"...\"},...] or IA_LOGGED_IN_USER / IA_LOGGED_IN_SIG in the environment."
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
  let identifiers = [...redumpIds, ...dlcIds, ...titleUpdateIds];
  if (IDENTIFIER_LIMIT > 0) {
    identifiers = identifiers.slice(0, IDENTIFIER_LIMIT);
  }
  const map = {};
  let redumpCount = 0;
  let dlcCount = 0;
  let updateCount = 0;

  for (const identifier of identifiers) {
    const metadataUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}?output=json`;
    try {
      const pair = randomCookiePair(cookiePool) ?? fallbackPair;
      const cookieHeader = buildIaCookieHeader(pair);
      const metadata = await fetchJson(metadataUrl, cookieHeader);
      const files = Array.isArray(metadata.files) ? metadata.files : [];
      for (const file of files) {
        const filename = file?.name;
        if (typeof filename !== "string") continue;
        if (!/\.(zip|iso|7z)$/i.test(filename)) continue;
        if (FILTER_TO_MASTER && !targetFilenames.has(filename)) continue;
        if (map[filename]) continue;
        map[filename] = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodePathSegment(filename)}`;
        if (/^XBOX_360_DLC_\d+$/i.test(identifier)) dlcCount += 1;
        else if (/^microsoft_xbox360_title-updates$/i.test(identifier)) updateCount += 1;
        else redumpCount += 1;
      }
      // eslint-disable-next-line no-console
      console.log(`Mapped from ${identifier}: ${Object.keys(map).length} total files`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed ${identifier}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${Object.keys(map).length} mappings (${redumpCount} redump, ${dlcCount} DLC, ${updateCount} title updates) to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
