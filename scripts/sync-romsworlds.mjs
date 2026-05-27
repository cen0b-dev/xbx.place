import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const CANONICAL_PATH = path.join(DATA_DIR, "romsworlds-index.json");
const OUTPUT_PATH = path.join(PUBLIC_DIR, "master_index.json");
const CATALOG_URL = "https://romsworlds.com/microsoft/xbox-360";
const FILE_LINK_RE = /https:\/\/file\.romsworlds\.com\/xbox-360\/[^"'\\s<>]+\.(?:zip|iso)/gi;
const ANCHOR_RE = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#8217;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#8211;", "-");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeTitle(value) {
  return value
    .replace(/\s*-\s*xbox\s*360$/i, "")
    .replace(/\s*xbox\s*360\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleIdFor(name) {
  return createHash("md5").update(name).digest("hex").slice(0, 8).toUpperCase();
}

function sanitizeDisplayName(filename) {
  return filename
    .replace(/\.(zip|iso)$/i, "")
    .replace(/\s*\(xbox\s*360\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRegions(filename) {
  const tags = new Set();
  const matches = filename.match(/\(([^)]+)\)/g) ?? [];
  for (const raw of matches) {
    const value = raw.slice(1, -1).toLowerCase();
    if (value.includes("usa")) tags.add("USA");
    if (value.includes("europe")) tags.add("Europe");
    if (value.includes("japan")) tags.add("Japan");
    if (value.includes("world")) tags.add("World");
    if (value.includes("region free")) tags.add("Region Free");
  }
  return [...tags];
}

function parseLanguages(filename) {
  const tags = new Set();
  const regionChunks = filename.match(/\(([^)]+)\)/g) ?? [];
  for (const raw of regionChunks) {
    const value = raw.slice(1, -1);
    if (!/^[A-Za-z]{2,16}$/.test(value.replace(/\s+/g, ""))) continue;
    if (value.length < 4) continue;
    tags.add(value);
  }
  return [...tags];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "xbx.place romsworlds sync"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

function extractPageLinks(catalogHtml) {
  const links = new Set([CATALOG_URL]);
  const regex = /https:\/\/romsworlds\.com\/microsoft\/xbox-360\/page\/\d+\/?/gi;
  for (const match of catalogHtml.match(regex) ?? []) {
    links.add(match.replace(/\/+$/, ""));
  }
  return [...links];
}

function extractGameLinks(pageHtml) {
  const links = new Set();
  const regex = /https:\/\/romsworlds\.com\/microsoft\/[^"'\\s<>]+/gi;
  for (const match of pageHtml.match(regex) ?? []) {
    if (match.includes("/xbox-360") || match.includes("/feed") || match.includes("/page/") || match.includes("?orderby=")) {
      continue;
    }
    links.add(match.replace(/\/+$/, ""));
  }
  return [...links];
}

function extractTitle(pageHtml) {
  const h1 = pageHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1?.[1]) return null;
  return normalizeTitle(stripTags(h1[1]));
}

function extractRating(pageHtml) {
  const rating = pageHtml.match(/([0-5](?:\.[0-9])?)\s*<\/[^>]*>\s*<\/[^>]*>\s*$/m);
  if (!rating?.[1]) return null;
  const value = Number.parseFloat(rating[1]);
  return Number.isFinite(value) ? value : null;
}

function extractDownloads(pageHtml) {
  const downloads = [];
  const seen = new Set();
  for (const url of pageHtml.match(FILE_LINK_RE) ?? []) {
    if (seen.has(url)) continue;
    seen.add(url);
    const fileNameRaw = decodeURIComponent(url.split("/").at(-1) ?? "");
    if (!fileNameRaw) continue;
    const displayName = sanitizeDisplayName(fileNameRaw);
    downloads.push({
      filename: fileNameRaw,
      url,
      type: "ROM",
      label: displayName
    });
  }
  return downloads;
}

function extractDownloadVariantLinks(pageHtml, gameUrl) {
  const links = new Set();
  for (const match of pageHtml.match(new RegExp(`${gameUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?download=\\d+`, "gi")) ?? []) {
    links.add(match);
  }
  return [...links];
}

function isAllowedDownloadHost(url) {
  const lower = url.toLowerCase();
  const blocked = ["facebook.com", "twitter.com", "youtube.com", "linkedin.com", "pinterest.com", "t.me", "maxdroid", "switchrom.org"];
  if (blocked.some((token) => lower.includes(token))) return false;
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function extractAnchorDownloads(pageHtml) {
  const downloads = [];
  const seen = new Set();
  for (const [, href, inner] of pageHtml.matchAll(ANCHOR_RE)) {
    if (!href || seen.has(href) || !isAllowedDownloadHost(href)) continue;
    if (href.includes("romsworlds.com")) continue;
    const label = stripTags(inner);
    if (!/download|direct|iso|rom|file|mirror/i.test(label)) continue;
    seen.add(href);
    downloads.push({
      filename: label || "External mirror download",
      url: href,
      type: "Mirror",
      label
    });
  }
  return downloads;
}

async function loadCanonicalFallback() {
  try {
    const raw = await readFile(CANONICAL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.titles)) {
      return parsed.titles;
    }
  } catch {
    // ignore fallback errors
  }
  return [];
}

function buildEntry(name, downloads, rating) {
  const first = downloads[0];
  const derivedRegions = first ? parseRegions(first.filename) : [];
  const languageTags = first ? parseLanguages(first.filename) : [];
  return {
    title_id: titleIdFor(name),
    name,
    rating,
    regions: derivedRegions,
    genre: [],
    description: "Mirror sourced from romsworlds.",
    downloads,
    metadata: {
      source: "romsworlds",
      languageTags
    }
  };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  let titles = [];

  try {
    const firstPage = await fetchText(CATALOG_URL);
    const catalogPages = extractPageLinks(firstPage);
    const gameLinks = new Set(extractGameLinks(firstPage));

    for (const pageUrl of catalogPages.slice(1)) {
      try {
        const html = await fetchText(pageUrl);
        for (const gameLink of extractGameLinks(html)) {
          gameLinks.add(gameLink);
        }
      } catch (error) {
        console.warn(`Skipping catalog page ${pageUrl}: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    const entries = [];
    for (const gameUrl of gameLinks) {
      try {
        const html = await fetchText(gameUrl);
        const name = extractTitle(html);
        if (!name) continue;
        const downloads = extractDownloads(html);
        const variantPages = extractDownloadVariantLinks(html, gameUrl);
        for (const variant of variantPages) {
          try {
            const variantHtml = await fetchText(variant);
            downloads.push(...extractDownloads(variantHtml));
            downloads.push(...extractAnchorDownloads(variantHtml));
          } catch (error) {
            console.warn(`Skipping variant ${variant}: ${error instanceof Error ? error.message : "unknown"}`);
          }
        }
        if (!downloads.length) continue;
        entries.push(buildEntry(name, downloads, extractRating(html)));
      } catch (error) {
        console.warn(`Skipping game ${gameUrl}: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }

    const deduped = new Map();
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      const existing = deduped.get(key);
      if (!existing || existing.downloads.length < entry.downloads.length) {
        deduped.set(key, entry);
      }
    }
    titles = [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!titles.length) {
      titles = await loadCanonicalFallback();
    }
  } catch (error) {
    console.warn(`Remote sync failed: ${error instanceof Error ? error.message : "unknown"}`);
    titles = await loadCanonicalFallback();
  }

  const canonical = {
    generatedAt: new Date().toISOString(),
    source: CATALOG_URL,
    count: titles.length,
    titles
  };

  await writeFile(CANONICAL_PATH, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
  await writeFile(OUTPUT_PATH, `${JSON.stringify(titles, null, 2)}\n`, "utf8");
  console.log(`Wrote ${titles.length} titles to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
