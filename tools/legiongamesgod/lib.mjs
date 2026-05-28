/** @typedef {{ url: string; status: number; body: string }} FetchResult */

export const BASE = "https://legiongamesgod.com";
export const XBOX360_INDEX = `${BASE}/xbox-360/`;
export const SITEMAP_POSTS = `${BASE}/wp-sitemap-posts-post-1.xml`;

export const GAME_URL_RE = /https:\/\/legiongamesgod\.com\/juegos\/[^"'<> \t]+/gi;
export const SECTION_URL_RE = /https:\/\/legiongamesgod\.com\/xbox-360\/[^"'<> \t]+\/?/gi;
export const PAGE_COUNT_RE = /Page \d+ of (\d+)/i;
export const SITEMAP_LOC_RE = /<loc>(https:\/\/legiongamesgod\.com\/[^<]+)<\/loc>/gi;
export const SITEMAP_JUEGOS_RE = /^https:\/\/legiongamesgod\.com\/juegos\//i;

export const HOST_PATTERNS = [
  { id: "mediafire", re: /mediafire\.com/i },
  { id: "google_sites", re: /sites\.google\.com/i },
  { id: "google_drive", re: /drive\.google\.com/i },
  { id: "mega", re: /mega\.nz/i },
  { id: "archive_org", re: /archive\.org/i },
  { id: "1fichier", re: /1fichier\.com/i }
];

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; xbx-place-tools/1.0; +https://xbx.place)";

/**
 * @param {number} limit
 */
export function createPool(limit) {
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      active += 1;
      const run = queue.shift();
      run?.();
    }
  };

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  return (fn) =>
    new Promise((resolve, reject) => {
      const start = () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            pump();
          });
      };
      queue.push(start);
      pump();
    });
}

/**
 * @param {string} url
 * @param {{ retries?: number; timeoutMs?: number }} [opts]
 */
export async function fetchText(url, opts = {}) {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let lastErr;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": DEFAULT_UA, Accept: "text/html,application/xml" },
        redirect: "follow",
        signal: ac.signal
      });
      const body = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return { url, status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await sleep(250 * (attempt + 1));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string} html */
export function extractGameUrls(html) {
  const out = new Set();
  for (const m of html.matchAll(GAME_URL_RE)) {
    const raw = m[0].replace(/\/+$/, "");
    out.add(raw.endsWith("/") ? raw : `${raw}/`);
  }
  return out;
}

/** @param {string} sectionUrl */
export function listingPageUrls(sectionUrl) {
  const base = sectionUrl.endsWith("/") ? sectionUrl : `${sectionUrl}/`;
  return (pageCount) => {
    const urls = [base];
    for (let p = 2; p <= pageCount; p += 1) {
      urls.push(`${base}?avia-element-paging=${p}`);
    }
    return urls;
  };
}

/** @param {string} html */
export function pageCountFromHtml(html) {
  const m = html.match(PAGE_COUNT_RE);
  if (!m?.[1]) return 1;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** @param {string} html */
export function detectHosts(html) {
  const found = [];
  for (const { id, re } of HOST_PATTERNS) {
    if (re.test(html)) found.push(id);
  }
  return found;
}

/** @param {string} xml */
export function extractSitemapUrls(xml) {
  const all = new Set();
  const juegos = new Set();
  for (const m of xml.matchAll(SITEMAP_LOC_RE)) {
    all.add(m[1]);
    if (SITEMAP_JUEGOS_RE.test(m[1])) juegos.add(m[1]);
  }
  return { all, juegos };
}
