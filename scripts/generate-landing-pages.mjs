import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSlugMap, gamePath } from "./slug-utils.mjs";

const ROOT = process.cwd();
const MASTER_INDEX = path.join(ROOT, "public", "master_index.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const BASE = "https://xbx.place";
const DEFAULT_OG = `${BASE}/og-image.png`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isAddonOnly(entry) {
  return entry.downloads?.length > 0 && !entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM");
}

function countPackages(titles, type) {
  let count = 0;
  for (const entry of titles) {
    for (const dl of entry.downloads ?? []) {
      if (dl.type === type) count += 1;
    }
  }
  return count;
}

function pageShell({ title, description, canonical, jsonLd = [], body }) {
  const ldBlocks = jsonLd.map((data) => `<script type="application/ld+json">${data}</script>`).join("\n    ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="xbx.place" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DEFAULT_OG}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${DEFAULT_OG}" />
    ${ldBlocks}
    <style>
      body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#101010;color:#e8e8e8;line-height:1.65}
      main{max-width:860px;margin:0 auto;padding:48px 20px}
      h1,h2,h3{color:#fff}
      h1{font-size:clamp(1.5rem,4vw,2rem);line-height:1.2}
      a{color:#5fdb5f}
      .site-header{max-width:860px;margin:0 auto;padding:28px 20px 0}
      .site-header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:1.15rem;font-weight:600}
      .site-header img{width:32px;height:32px;object-fit:contain;display:block}
      .lead{color:#ccc;font-size:1.02rem}
      .cta{display:inline-block;margin:20px 0;padding:12px 24px;background:#107c10;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
      .stats{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}
      .stat{padding:8px 14px;border-radius:999px;background:#ffffff0a;border:1px solid #ffffff12;font-size:.85rem;color:#aaa}
      .stat strong{color:#fff}
      ol,ul{padding-left:20px}
      .footer-links{margin-top:40px;padding-top:20px;border-top:1px solid #333;font-size:.9rem}
      .footer-links a{margin-right:16px}
    </style>
  </head>
  <body>
    <header class="site-header">
      <a href="/"><img src="/logo.png" width="32" height="32" alt="" /><span>xbx.place</span></a>
    </header>
    <main>${body}</main>
  </body>
</html>`;
}

function faqJsonLd(questions) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  });
}

async function main() {
  const titles = JSON.parse(await readFile(MASTER_INDEX, "utf8"));
  const { byId: slugById } = buildSlugMap(titles);

  const addonTitles = titles.filter(isAddonOnly);
  const dlcPackages = countPackages(titles, "DLC");
  const updatePackages = countPackages(titles, "Update");
  const topAddons = addonTitles
    .slice()
    .sort((a, b) => (b.downloads?.length ?? 0) - (a.downloads?.length ?? 0))
    .slice(0, 30);

  const addonLinks = topAddons
    .map((entry) => {
      const slug = slugById[String(entry.title_id).toUpperCase()];
      const href = slug ? gamePath(slug) : "/";
      return `<li><a href="${href}">${escapeHtml(entry.name)}</a></li>`;
    })
    .join("\n        ");

  const dlcPage = pageShell({
    title: "Xbox 360 DLC Download — Free Add-ons & Title Updates | xbx.place",
    description: `Download Xbox 360 DLC and title updates free. Browse ${addonTitles.length.toLocaleString()} add-on titles with ${dlcPackages.toLocaleString()} DLC packs and ${updatePackages.toLocaleString()} updates — searchable catalog with cover art.`,
    canonical: `${BASE}/xbox-360-dlc.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "Where can I download Xbox 360 DLC?",
          a: "xbx.place catalogs Xbox 360 DLC packs and title updates alongside full games. Browse the Add-ons & DLC section or search by game name.",
        },
        {
          q: "Are Xbox 360 title updates included?",
          a: "Yes — xbx.place lists title updates (TU) packages linked to their parent games, with metadata and download links.",
        },
      ]),
    ],
    body: `
      <h1>Xbox 360 DLC & Title Updates</h1>
      <p class="lead">
        Download Xbox 360 DLC packs and title updates free. xbx.place is one of the few catalogs
        that indexes add-on content separately from base games — with searchable metadata, cover art,
        and parent-game links.
      </p>
      <div class="stats">
        <span class="stat"><strong>${addonTitles.length.toLocaleString()}</strong> add-on titles</span>
        <span class="stat"><strong>${dlcPackages.toLocaleString()}</strong> DLC packages</span>
        <span class="stat"><strong>${updatePackages.toLocaleString()}</strong> title updates</span>
      </div>
      <a class="cta" href="/?category=DLC">Browse DLC &amp; updates</a>
      <h2>Popular add-on titles</h2>
      <ul>${addonLinks}</ul>
      <h2>FAQ</h2>
      <dl>
        <dt>Where can I download Xbox 360 DLC?</dt>
        <dd>Use the <a href="/?category=DLC">Add-ons &amp; DLC</a> tab on xbx.place to filter DLC packs and title updates, or open any game page to see linked add-on content.</dd>
        <dt>Do I need the base game?</dt>
        <dd>Yes — DLC and title updates require the corresponding base game installed on your Xbox 360 or in your Xenia game library.</dd>
      </dl>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/guides/xenia-xbox-360-roms.html">Xenia guide</a>
        <a href="/about.html">About</a>
      </div>`,
  });

  const xeniaPage = pageShell({
    title: "How to Download Xbox 360 ROMs for Xenia — Setup Guide | xbx.place",
    description:
      "Step-by-step guide to downloading Xbox 360 ROMs and ISOs for the Xenia emulator. Find compatible formats, extract files, and load games from xbx.place.",
    canonical: `${BASE}/guides/xenia-xbox-360-roms.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "What Xbox 360 file formats work with Xenia?",
          a: "Xenia supports extracted XEX folders, ISO images, and some GOD layouts. ISO and XEX dumps from Redump-aligned sources are the most common.",
        },
        {
          q: "Where can I download Xbox 360 ROMs for Xenia?",
          a: "xbx.place provides searchable Xbox 360 ISO and XEX downloads with metadata, ratings, and cover art.",
        },
      ]),
    ],
    body: `
      <h1>How to Download Xbox 360 ROMs for Xenia</h1>
      <p class="lead">
        This guide walks through finding, downloading, and loading Xbox 360 games in
        <a href="https://xenia-emulator.com/">Xenia</a> using files from xbx.place.
      </p>
      <h2>1. Install Xenia</h2>
      <p>Download the latest Xenia Canary or Master build from the official site. Extract the archive and run the emulator on Windows or Linux.</p>
      <h2>2. Find a compatible dump</h2>
      <p>Browse the <a href="/">xbx.place catalog</a> or <a href="/xbox-360-roms.html">Xbox 360 ROMs</a> landing page. Look for ISO or XEX format downloads. Community ratings help surface well-tested titles.</p>
      <h2>3. Download from xbx.place</h2>
      <p>Open a game page and choose your preferred file format. Archives may need extraction with 7-Zip or similar before loading in Xenia.</p>
      <h2>4. Load the game in Xenia</h2>
      <ol>
        <li><strong>ISO:</strong> File → Open and select the <code>.iso</code> file.</li>
        <li><strong>XEX folder:</strong> Open the folder containing <code>default.xex</code>.</li>
      </ol>
      <h2>5. Add DLC and title updates (optional)</h2>
      <p>Many games have DLC packs and title updates on xbx.place. See our <a href="/xbox-360-dlc.html">DLC catalog</a> or open a game's detail page for linked add-ons.</p>
      <h2>FAQ</h2>
      <dl>
        <dt>Do all Xbox 360 games work on Xenia?</dt>
        <dd>No — compatibility varies. Check the Xenia compatibility database before expecting a specific title to run.</dd>
        <dt>ISO vs XEX — which is better?</dt>
        <dd>Both work. ISO is a single file; XEX is an extracted folder. Pick whichever your download provides.</dd>
      </dl>
      <a class="cta" href="/">Browse Xbox 360 ROMs</a>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/xbox-360-dlc.html">DLC</a>
        <a href="/about.html">About</a>
      </div>`,
  });

  await writeFile(path.join(PUBLIC_DIR, "xbox-360-dlc.html"), dlcPage, "utf8");
  await mkdir(path.join(PUBLIC_DIR, "guides"), { recursive: true });
  await writeFile(path.join(PUBLIC_DIR, "guides/xenia-xbox-360-roms.html"), xeniaPage, "utf8");
  console.log("Wrote xbox-360-dlc.html and guides/xenia-xbox-360-roms.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
