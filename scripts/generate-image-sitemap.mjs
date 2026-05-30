import fs from "node:fs";
import path from "node:path";
import { buildSlugMap, gamePath } from "./slug-utils.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "https://xbx.place";
const titles = JSON.parse(fs.readFileSync(path.join(ROOT, "public/master_index.json"), "utf8"));
const { byId } = buildSlugMap(Array.isArray(titles) ? titles : titles.titles ?? []);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function coverUrl(titleId) {
  const id = String(titleId).toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(id)) return null;
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${id}/artwork/boxart.jpg`;
}

const entries = [];
for (const title of Array.isArray(titles) ? titles : titles.titles ?? []) {
  const titleId = String(title.title_id).toUpperCase();
  const slug = byId[titleId];
  const image = coverUrl(title.metadata?.cover_title_id ?? titleId);
  if (!slug || !image) continue;
  const pageUrl = `${BASE}${gamePath(slug)}`;
  entries.push(`  <url>
    <loc>${escapeXml(pageUrl)}</loc>
    <image:image>
      <image:loc>${escapeXml(image)}</image:loc>
      <image:title>${escapeXml(`${title.name} Xbox 360 cover art`)}</image:title>
    </image:image>
  </url>`);
}

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ...entries,
  "</urlset>",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "public/sitemap-images.xml"), xml);
console.log(`Wrote ${entries.length} image URLs to public/sitemap-images.xml`);
