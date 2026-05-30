import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const MASTER_INDEX = path.join(ROOT, "public", "master_index.json");
const SLUG_MAP = path.join(ROOT, "public", "game-slugs.json");
const GENRE_DIR = path.join(ROOT, "public", "genre");
const SITEMAP_OUT = path.join(ROOT, "public", "sitemap.xml");
const BASE = "https://xbx.place";

const STATIC_PAGES = [
  { loc: `${BASE}/`, changefreq: "daily", priority: "1.0" },
  { loc: `${BASE}/xbox-360-roms.html`, changefreq: "monthly", priority: "0.9" },
  { loc: `${BASE}/xbox-360-dlc.html`, changefreq: "monthly", priority: "0.9" },
  { loc: `${BASE}/guides/`, changefreq: "monthly", priority: "0.85" },
  { loc: `${BASE}/guides/xenia-xbox-360-roms.html`, changefreq: "monthly", priority: "0.8" },
  { loc: `${BASE}/guides/redump-vs-iso.html`, changefreq: "monthly", priority: "0.8" },
  { loc: `${BASE}/guides/god-format.html`, changefreq: "monthly", priority: "0.8" },
  { loc: `${BASE}/guides/how-dlc-works-on-360.html`, changefreq: "monthly", priority: "0.8" },
  { loc: `${BASE}/guides/iso-to-god-usb.html`, changefreq: "monthly", priority: "0.8" },
  { loc: `${BASE}/press.html`, changefreq: "monthly", priority: "0.5" },
  { loc: `${BASE}/about.html`, changefreq: "monthly", priority: "0.6" },
  { loc: `${BASE}/dmca.html`, changefreq: "monthly", priority: "0.6" },
];

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry({ loc, changefreq, priority, lastmod }) {
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

async function listSubdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  await stat(MASTER_INDEX);
  const slugRaw = await readFile(SLUG_MAP, "utf8");
  const { byId } = JSON.parse(slugRaw);
  const genreSlugs = await listSubdirs(GENRE_DIR);
  const masterStat = await stat(MASTER_INDEX);
  const lastmod = masterStat.mtime.toISOString().slice(0, 10);

  const gameSlugs = Object.values(byId);

  const entries = [
    ...STATIC_PAGES.map((page) => urlEntry({ ...page, lastmod })),
    ...genreSlugs.map((slug) =>
      urlEntry({
        loc: `${BASE}/genre/${encodeURIComponent(slug)}/`,
        changefreq: "weekly",
        priority: "0.85",
        lastmod,
      })
    ),
    ...gameSlugs.map((slug) =>
      urlEntry({
        loc: `${BASE}/game/${encodeURIComponent(slug)}/`,
        changefreq: "weekly",
        priority: "0.9",
        lastmod,
      })
    ),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");

  await writeFile(SITEMAP_OUT, xml, "utf8");
  console.log(
    `Wrote ${entries.length} URLs to public/sitemap.xml (${genreSlugs.length} genre, ${gameSlugs.length} game, ${STATIC_PAGES.length} static)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
