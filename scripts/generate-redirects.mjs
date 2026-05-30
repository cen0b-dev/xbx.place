import fs from "node:fs";
import path from "node:path";
import { buildSlugMap, gamePath } from "./slug-utils.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://xbx.place";
const master = JSON.parse(fs.readFileSync(path.join(ROOT, "public/master_index.json"), "utf8"));
const titles = Array.isArray(master) ? master : master.titles ?? [];
const { byId } = buildSlugMap(titles);

const slugMapPath = path.join(ROOT, "public/game-slugs.json");
fs.writeFileSync(slugMapPath, `${JSON.stringify({ byId, bySlug: Object.fromEntries(Object.entries(byId).map(([id, slug]) => [slug, id])) }, null, 0)}\n`);

const idRedirects = [
  "# Legacy genre query → path URLs",
  "/?genre=action /genre/action/ 301",
  "/?genre=shooter /genre/shooter/ 301",
  "/?genre=rpg /genre/rpg/ 301",
  "/?genre=racing /genre/racing/ 301",
  "/?genre=sports /genre/sports/ 301",
  "/?genre=fighting /genre/fighting/ 301",
  "/?genre=strategy /genre/strategy/ 301",
  "/?genre=family /genre/family/ 301",
  "/?genre=platformer /genre/platformer/ 301",
  "/?genre=music /genre/music/ 301",
  "/?genre=puzzle /genre/puzzle/ 301",
  "",
  "# Legacy title query + ID paths → slug paths",
];
for (const title of titles) {
  const titleId = String(title.title_id).toUpperCase();
  const slug = byId[titleId];
  if (!slug) continue;
  idRedirects.push(`/?title=${titleId} ${gamePath(slug)} 301`);
  idRedirects.push(`/?title=${titleId}/ ${gamePath(slug)} 301`);
  idRedirects.push(`/game/${titleId}/ ${gamePath(slug)} 301`);
}

const redirectsPath = path.join(ROOT, "public/_redirects");
fs.writeFileSync(redirectsPath, `${idRedirects.join("\n")}\n`);

function idRedirectHtml(slug) {
  const target = `${SITE}${gamePath(slug)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0;url=${gamePath(slug)}">
<title>Redirecting…</title>
<script>location.replace(${JSON.stringify(gamePath(slug))})</script>
</head>
<body></body>
</html>
`;
}

let redirectPages = 0;
for (const title of titles) {
  const titleId = String(title.title_id).toUpperCase();
  const slug = byId[titleId];
  if (!slug) continue;
  const dir = path.join(ROOT, "public/game", titleId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), idRedirectHtml(slug));
  redirectPages++;
}

console.log(`Wrote game-slugs.json (${Object.keys(byId).length} slugs)`);
console.log(`Wrote _redirects (${idRedirects.length} game rules + patterns)`);
console.log(`Wrote ${redirectPages} ID redirect stub pages`);
