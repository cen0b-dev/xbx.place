#!/usr/bin/env node
/**
 * Fast LegionGamesGod Xbox 360 catalog scan.
 * Crawls /xbox-360/ letter pages (with pagination) in parallel — no browser, no DOM parser.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  SITEMAP_POSTS,
  XBOX360_INDEX,
  createPool,
  detectHosts,
  extractGameUrls,
  extractSitemapUrls,
  fetchText,
  listingPageUrls,
  pageCountFromHtml,
  SECTION_URL_RE,
  sleep
} from "./lib.mjs";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(TOOL_DIR, "output");

function parseArgs(argv) {
  const opts = {
    hosts: false,
    hostsSample: 40,
    hostsConcurrency: 24,
    concurrency: 32,
    sitemap: false,
    quiet: false
  };
  for (const arg of argv) {
    if (arg === "--hosts") opts.hosts = true;
    else if (arg === "--sitemap") opts.sitemap = true;
    else if (arg === "--quiet" || arg === "-q") opts.quiet = true;
    else if (arg.startsWith("--hosts-sample=")) {
      opts.hostsSample = Math.max(1, Number.parseInt(arg.slice(17), 10) || 40);
    } else if (arg.startsWith("--concurrency=")) {
      opts.concurrency = Math.max(1, Number.parseInt(arg.slice(14), 10) || 32);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node tools/legiongamesgod/scan-xbox360.mjs [options]

Options:
  --sitemap              Also fetch wp-sitemap-posts-post-1.xml (all /juegos/ posts site-wide)
  --hosts                Sample game pages and classify download hosts (slower)
  --hosts-sample=N       Game pages to sample for --hosts (default 40)
  --concurrency=N        Parallel HTTP requests (default 32)
  -q, --quiet            Only print summary JSON path and counts

Writes:
  tools/legiongamesgod/output/xbox360-games.json
  tools/legiongamesgod/output/scan-summary.json
`);
}

function log(quiet, ...args) {
  if (!quiet) console.log(...args);
}

/**
 * @param {string[]} urls
 * @param {number} concurrency
 */
async function fetchAll(urls, concurrency) {
  const pool = createPool(concurrency);
  const results = await Promise.all(urls.map((url) => pool(() => fetchText(url))));
  return new Map(results.map((r) => [r.url, r.body]));
}

async function scanXbox360Listing(concurrency) {
  const t0 = performance.now();
  const index = await fetchText(XBOX360_INDEX);
  const sections = [
    ...new Set(
      (index.body.match(SECTION_URL_RE) ?? []).map((u) => (u.endsWith("/") ? u : `${u}/`))
    )
  ].sort();

  const pool = createPool(concurrency);
  const sectionMeta = await Promise.all(
    sections.map((sectionUrl) =>
      pool(async () => {
        const { body } = await fetchText(sectionUrl);
        const pages = pageCountFromHtml(body);
        return { sectionUrl, pages, firstBody: body };
      })
    )
  );

  const listingUrls = new Set();
  for (const { sectionUrl, pages, firstBody } of sectionMeta) {
    const urls = listingPageUrls(sectionUrl)(pages);
    listingUrls.add(urls[0]);
    for (let i = 1; i < urls.length; i += 1) {
      listingUrls.add(urls[i]);
    }
  }

  const toFetch = [...listingUrls].filter((u) => !sectionMeta.some((m) => m.sectionUrl === u));
  const fetched = await fetchAll(toFetch, concurrency);

  const games = new Set();
  for (const { sectionUrl, pages, firstBody } of sectionMeta) {
    extractGameUrls(firstBody).forEach((g) => games.add(g));
    const urls = listingPageUrls(sectionUrl)(pages);
    for (let i = 1; i < urls.length; i += 1) {
      const html = fetched.get(urls[i]);
      if (html) extractGameUrls(html).forEach((g) => games.add(g));
    }
  }

  return {
    sections: sections.length,
    listingPages: listingUrls.size,
    gameCount: games.size,
    games: [...games].sort(),
    ms: Math.round(performance.now() - t0)
  };
}

async function scanSitemap() {
  const t0 = performance.now();
  const { body } = await fetchText(SITEMAP_POSTS);
  const { all, juegos } = extractSitemapUrls(body);
  const dlcish = [...juegos].filter((u) => /dlc|title-update|\-tu\b/i.test(u)).length;
  return {
    postCount: all.size,
    juegosCount: juegos.size,
    otherPostCount: all.size - juegos.size,
    dlcOrTuSlugCount: dlcish,
    ms: Math.round(performance.now() - t0)
  };
}

/**
 * @param {string[]} gameUrls
 * @param {number} sampleSize
 * @param {number} concurrency
 */
async function sampleHosts(gameUrls, sampleSize, concurrency) {
  const t0 = performance.now();
  const pick = gameUrls.length <= sampleSize ? gameUrls : shufflePick(gameUrls, sampleSize);
  const pool = createPool(concurrency);
  const hostCounts = Object.create(null);
  const perGame = [];

  await Promise.all(
    pick.map((gameUrl) =>
      pool(async () => {
        await sleep(Math.random() * 80);
        const { body } = await fetchText(gameUrl);
        const hosts = detectHosts(body);
        for (const h of hosts) {
          hostCounts[h] = (hostCounts[h] ?? 0) + 1;
        }
        perGame.push({ url: gameUrl, hosts });
      })
    )
  );

  const mediafire = hostCounts.mediafire ?? 0;
  return {
    sampled: pick.length,
    hostCounts,
    mediafirePct: pick.length ? Math.round((mediafire / pick.length) * 1000) / 10 : 0,
    perGame,
    ms: Math.round(performance.now() - t0)
  };
}

/** @param {string[]} arr @param {number} n */
function shufflePick(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(OUTPUT_DIR, { recursive: true });

  const started = new Date().toISOString();
  const t0 = performance.now();

  log(opts.quiet, "Scanning Xbox 360 listing…");
  const listing = await scanXbox360Listing(opts.concurrency);

  /** @type {Record<string, unknown>} */
  const summary = {
    source: BASE,
    scannedAt: started,
    xbox360: {
      sections: listing.sections,
      listingPages: listing.listingPages,
      gameCount: listing.gameCount,
      ms: listing.ms
    },
    downloads: {
      note: "Listing pages link to /juegos/… posts; ROM hosts live on those pages (often Google Sites, not MediaFire)."
    }
  };

  if (opts.sitemap) {
    log(opts.quiet, "Fetching WordPress post sitemap…");
    summary.sitemap = await scanSitemap();
  }

  if (opts.hosts) {
    log(opts.quiet, `Sampling ${opts.hostsSample} game pages for hosts…`);
    summary.hostSample = await sampleHosts(
      listing.games,
      opts.hostsSample,
      opts.hostsConcurrency
    );
  }

  summary.totalMs = Math.round(performance.now() - t0);

  const gamesPath = path.join(OUTPUT_DIR, "xbox360-games.json");
  const summaryPath = path.join(OUTPUT_DIR, "scan-summary.json");

  await writeFile(
    gamesPath,
    `${JSON.stringify({ scannedAt: started, count: listing.gameCount, games: listing.games }, null, 2)}\n`
  );
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (opts.quiet) {
    console.log(
      JSON.stringify({
        gameCount: listing.gameCount,
        gamesPath,
        summaryPath,
        totalMs: summary.totalMs
      })
    );
  } else {
    console.log("");
    console.log(`Xbox 360 games (listing crawl): ${listing.gameCount}`);
    console.log(`  sections: ${listing.sections}, pages: ${listing.listingPages}, ${listing.ms} ms`);
    if (summary.sitemap) {
      console.log(
        `Sitemap posts: ${summary.sitemap.postCount} total, ${summary.sitemap.juegosCount} /juegos/, ${summary.sitemap.otherPostCount} other (XBLA, Xbox Clásico, …)`
      );
      console.log(`  /juegos/ with DLC/TU-ish slug: ${summary.sitemap.dlcOrTuSlugCount}`);
    }
    if (summary.hostSample) {
      console.log(`Host sample (${summary.hostSample.sampled} pages):`, summary.hostSample.hostCounts);
      console.log(`  MediaFire in sample: ${summary.hostSample.mediafirePct}%`);
    }
    console.log(`Total: ${summary.totalMs} ms`);
    console.log(`Wrote ${gamesPath}`);
    console.log(`Wrote ${summaryPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
