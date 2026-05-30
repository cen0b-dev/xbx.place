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

const GUIDES = [
  {
    slug: "xenia-xbox-360-roms",
    title: "How to Use Xenia",
    description: "Download & load Xbox 360 ROMs in Xenia emulator.",
    tag: "Emulation",
  },
  {
    slug: "redump-vs-iso",
    title: "Redump vs ISO",
    description: "What Redump-verified dumps are and why format matters.",
    tag: "Formats",
  },
  {
    slug: "god-format",
    title: "GOD Format Explained",
    description: "What Games on Demand format is and when to use it.",
    tag: "Formats",
  },
  {
    slug: "how-dlc-works-on-360",
    title: "How DLC Works on Xbox 360",
    description: "Installing & managing DLC on real hardware and emulators.",
    tag: "DLC",
  },
  {
    slug: "iso-to-god-usb",
    title: "ISO → GOD + USB Install",
    description: "Convert an ISO to GOD and install it to a USB for a modded console.",
    tag: "Modding",
  },
];

function guideFooter(currentSlug) {
  return `
      <div class="footer-links">
        <a href="/guides/">All guides</a>
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/xbox-360-dlc.html">DLC</a>
        <a href="/about.html">About</a>
      </div>`;
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
      <p>Need help with formats or installation? Check the <a href="/guides/">xbx.place guides</a>.</p>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/guides/">Guides</a>
        <a href="/about.html">About</a>
      </div>`,
  });

  // ── guides/xenia-xbox-360-roms.html ────────────────────────────────────────
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
      <p>Many games have DLC packs and title updates on xbx.place. See our <a href="/xbox-360-dlc.html">DLC catalog</a> or open a game's detail page for linked add-ons. For more on how DLC works, read the <a href="/guides/how-dlc-works-on-360.html">DLC guide</a>.</p>
      <h2>FAQ</h2>
      <dl>
        <dt>Do all Xbox 360 games work on Xenia?</dt>
        <dd>No — compatibility varies. Check the Xenia compatibility database before expecting a specific title to run.</dd>
        <dt>ISO vs XEX — which is better?</dt>
        <dd>Both work. ISO is a single file; XEX is an extracted folder. Pick whichever your download provides. See <a href="/guides/redump-vs-iso.html">Redump vs ISO</a> for more detail.</dd>
      </dl>
      <a class="cta" href="/">Browse Xbox 360 ROMs</a>
      ${guideFooter("xenia-xbox-360-roms")}`,
  });

  // ── guides/redump-vs-iso.html ───────────────────────────────────────────────
  const redumpPage = pageShell({
    title: "Redump vs ISO — Xbox 360 Dump Formats Explained | xbx.place",
    description:
      "Understand the difference between Redump-verified Xbox 360 dumps and raw ISO images. Learn which format to choose for Xenia or real hardware.",
    canonical: `${BASE}/guides/redump-vs-iso.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "What is a Redump dump?",
          a: "Redump is a preservation project that defines exact specifications for disc images. A Redump-verified dump is a bit-perfect copy of the original disc, matching a community-verified hash.",
        },
        {
          q: "Is a Redump dump the same as an ISO?",
          a: "Both use the .iso file extension, but Redump dumps follow strict ripping standards. Not every .iso file is Redump-verified — some are raw rips that may be missing data or sector padding.",
        },
        {
          q: "Which format works best with Xenia?",
          a: "Xenia works well with Redump-aligned ISOs and extracted XEX folders. GOD-format containers are also supported but less common for emulation.",
        },
      ]),
    ],
    body: `
      <h1>Redump vs ISO — Xbox 360 Dump Formats Explained</h1>
      <p class="lead">
        When downloading Xbox 360 games you'll encounter terms like "Redump", "ISO", "XEX", and
        "GOD". This guide explains what each means and how to choose the right one.
      </p>

      <h2>What is an ISO?</h2>
      <p>
        An ISO is a single-file disc image — a byte-for-byte copy of a DVD or game disc. Xbox 360
        games typically ship on a dual-layer DVD, so an Xbox 360 ISO is usually around 7–8 GB.
        The file extension is <code>.iso</code> regardless of whether it was produced to Redump
        standards or not.
      </p>
      <div class="stats">
        <span class="stat"><strong>.iso</strong> file extension</span>
        <span class="stat"><strong>~7–8 GB</strong> typical size</span>
        <span class="stat"><strong>Single file</strong> — easy to manage</span>
      </div>

      <h2>What is Redump?</h2>
      <p>
        <a href="http://redump.org/">Redump.org</a> is a disc-preservation project that maintains
        a database of verified hashes for optical media. A <em>Redump dump</em> is an ISO that
        has been ripped according to Redump's strict methodology — correct sector size, full
        security sector preservation, and a hash that matches the database entry.
      </p>
      <p>
        Not every ISO you download is a Redump dump. Many older releases were ripped with tools
        that stripped padding, skipped security sectors, or trimmed the video partition —
        producing smaller but potentially broken files. Redump-verified dumps are generally the
        most reliable for both emulation and hardware use.
      </p>

      <h2>XEX — Extracted Folder Format</h2>
      <p>
        Some releases come as an extracted folder rather than an ISO. The folder contains
        <code>default.xex</code> (the main executable) and supporting files. Xenia can open
        these directly. XEX rips are convenient but are not preservation-grade in the way
        Redump ISOs are.
      </p>

      <h2>GOD — Games on Demand</h2>
      <p>
        GOD is Microsoft's proprietary container format for Xbox Live Marketplace downloads.
        It packages the game content into STFS (Secure Transacted File System) containers stored
        in a specific folder structure. GOD files can run from a USB drive on a modded console.
        See the <a href="/guides/god-format.html">GOD format guide</a> for full details, or
        <a href="/guides/iso-to-god-usb.html">ISO → GOD + USB install guide</a> to convert
        a download for real hardware use.
      </p>

      <h2>Which format should I download?</h2>
      <ul>
        <li><strong>Xenia emulator:</strong> ISO (Redump-aligned preferred) or XEX folder.</li>
        <li><strong>Modded Xbox 360 — disc bypass:</strong> ISO loaded via Freestyle Dash / JTAG.</li>
        <li><strong>Modded Xbox 360 — USB install:</strong> GOD format. Convert from ISO using <a href="/guides/iso-to-god-usb.html">this guide</a>.</li>
        <li><strong>Archiving:</strong> Redump-verified ISO — the gold standard for preservation.</li>
      </ul>

      <h2>How xbx.place labels files</h2>
      <p>
        Files on xbx.place are labeled by type (ISO, XEX, GOD, DLC, Update). Where source
        information is available, Redump-aligned dumps are noted. Always check the file details
        on the game page before downloading.
      </p>

      <h2>FAQ</h2>
      <dl>
        <dt>Can I convert an ISO to GOD?</dt>
        <dd>Yes — see the <a href="/guides/iso-to-god-usb.html">ISO → GOD + USB install guide</a> for step-by-step instructions.</dd>
        <dt>Why are some ISOs smaller than 7 GB?</dt>
        <dd>Older rips often trimmed the video partition or stripped padding sectors, reducing file size. These are not Redump-compliant and may cause issues on some setups.</dd>
        <dt>Does Xenia require Redump dumps?</dt>
        <dd>No — Xenia works with most ISOs. Redump dumps are just more reliable because they are more complete copies of the original disc.</dd>
      </dl>
      <a class="cta" href="/">Browse Xbox 360 ROMs</a>
      ${guideFooter("redump-vs-iso")}`,
  });

  // ── guides/god-format.html ──────────────────────────────────────────────────
  const godPage = pageShell({
    title: "Xbox 360 GOD Format Explained — Games on Demand | xbx.place",
    description:
      "What the Xbox 360 GOD (Games on Demand) format is, how STFS containers work, and when to use GOD files on a modded console or Xenia.",
    canonical: `${BASE}/guides/god-format.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "What is Xbox 360 GOD format?",
          a: "GOD stands for Games on Demand — Microsoft's format for digitally distributed Xbox 360 games. Files are stored in STFS containers inside a specific folder structure on the hard drive or USB.",
        },
        {
          q: "Can GOD files run on a modded Xbox 360?",
          a: "Yes. On a JTAG/RGH modded console, GOD packages can be placed on a USB drive or internal HDD and launched directly from dashboards like Freestyle Dash or Aurora.",
        },
        {
          q: "Do GOD files work in Xenia?",
          a: "Xenia has partial GOD support. ISO or XEX formats are generally more reliable for emulation.",
        },
      ]),
    ],
    body: `
      <h1>Xbox 360 GOD Format Explained</h1>
      <p class="lead">
        GOD — Games on Demand — is the format Xbox 360 used for digitally distributed games
        purchased through Xbox Live Marketplace. Understanding GOD is essential if you want to
        run games from a USB drive on a modded console.
      </p>

      <h2>What is GOD?</h2>
      <p>
        When Microsoft sold digital Xbox 360 games, they were packaged using the
        <strong>STFS (Secure Transacted File System)</strong> container format. A GOD package
        is one or more STFS <em>Content</em> packages — large binary files with no extension —
        stored in a specific directory hierarchy.
      </p>

      <h2>Folder Structure</h2>
      <p>A GOD title on a USB drive or HDD looks like this:</p>
      <pre><code>Content/
  0000000000000000/
    &lt;TitleID&gt;/
      00007000/
        &lt;ContentHash&gt;   ← main game data (no file extension)
        &lt;ContentHash&gt;   ← additional data parts (if split)</code></pre>
      <p>
        The <code>0000000000000000</code> folder is the "offline" account container used for
        GOD packages that don't require a licence check. The <strong>Title ID</strong> is an
        8-character hex value unique to each game (e.g. <code>4D5307E6</code> for Halo 3).
        The <code>00007000</code> subfolder indicates the content type — full game.
      </p>
      <div class="stats">
        <span class="stat"><strong>STFS</strong> container format</span>
        <span class="stat"><strong>00007000</strong> content type for full games</span>
        <span class="stat"><strong>No file extension</strong> on data files</span>
      </div>

      <h2>How Content is Split</h2>
      <p>
        Games larger than ~4 GB are split across multiple STFS files in the same folder —
        the console reassembles them at runtime. Tools that convert ISO → GOD handle the
        splitting automatically.
      </p>

      <h2>GOD vs ISO — Use Cases</h2>
      <ul>
        <li><strong>GOD on modded console:</strong> Place the <code>Content/</code> folder on a USB drive formatted FAT32 (or the internal HDD), then launch from Freestyle Dash or Aurora.</li>
        <li><strong>GOD on Xenia:</strong> Partial support — Xenia can open some GOD packages but may refuse others. ISO or XEX is safer for emulation.</li>
        <li><strong>ISO ripped from disc:</strong> Better for emulation; must be converted if you want to run from USB on real hardware.</li>
      </ul>

      <h2>DLC and Title Updates as STFS</h2>
      <p>
        DLC packs and title updates use the same STFS container format as GOD but with
        different content-type codes. They live in the same <code>Content/</code> tree under
        their respective title IDs. See the <a href="/guides/how-dlc-works-on-360.html">DLC guide</a>
        for placement details.
      </p>

      <h2>Converting ISO to GOD</h2>
      <p>
        To play a downloaded ISO on a real modded Xbox 360 via USB, you need to convert it to
        GOD format first. Follow the full walkthrough in our
        <a href="/guides/iso-to-god-usb.html">ISO → GOD + USB install guide</a>.
      </p>

      <h2>FAQ</h2>
      <dl>
        <dt>Does GOD require an Xbox Live account?</dt>
        <dd>Not on a JTAG/RGH console — placing files under the <code>0000000000000000</code> account folder bypasses licence checks.</dd>
        <dt>Can I run GOD from a USB hub or does it have to be directly plugged in?</dt>
        <dd>Direct connection is most reliable. Some USB hubs work but power delivery and read speed can cause issues with large games.</dd>
        <dt>What file system should the USB drive use?</dt>
        <dd>FAT32 is the standard for Xbox 360 USB storage. Drives larger than 32 GB can still be formatted FAT32 using third-party tools.</dd>
      </dl>
      <a class="cta" href="/">Browse Xbox 360 ROMs</a>
      ${guideFooter("god-format")}`,
  });

  // ── guides/how-dlc-works-on-360.html ───────────────────────────────────────
  const dlcGuidePage = pageShell({
    title: "How DLC Works on Xbox 360 — Installing Add-ons & Updates | xbx.place",
    description:
      "Learn how Xbox 360 DLC and title updates work on real hardware and in Xenia. Covers STFS containers, folder placement, and loading add-on content.",
    canonical: `${BASE}/guides/how-dlc-works-on-360.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "How do I install DLC on a modded Xbox 360?",
          a: "Place the DLC STFS package inside Content/0000000000000000/<TitleID>/<ContentTypeCode>/ on your USB drive or HDD. The console will detect it automatically when you launch the game.",
        },
        {
          q: "How do I install DLC in Xenia?",
          a: "In Xenia, place the DLC STFS file inside the Content folder within your Xenia data directory, mirroring the same folder structure used on a real console.",
        },
        {
          q: "What is a title update on Xbox 360?",
          a: "A title update (TU) is a patch package in STFS format. It fixes bugs, adds features, or changes balance. The console applies it automatically when launching the game if it's installed.",
        },
      ]),
    ],
    body: `
      <h1>How DLC Works on Xbox 360</h1>
      <p class="lead">
        Xbox 360 DLC packs, title updates, and marketplace add-ons all use the same STFS
        container format. This guide explains how they're stored, installed, and loaded —
        on both real modded hardware and in Xenia.
      </p>

      <h2>The STFS Container</h2>
      <p>
        All Xbox 360 downloadable content — DLC, title updates, avatar items, themes — is
        packaged as <strong>STFS (Secure Transacted File System)</strong> containers. They look
        like ordinary files (usually no extension) and are placed inside a specific
        <code>Content/</code> directory structure keyed by Title ID and content type.
      </p>

      <h2>Content Type Codes</h2>
      <p>Each sub-folder under a Title ID represents a content type:</p>
      <ul>
        <li><code>00007000</code> — Full game (GOD)</li>
        <li><code>000B0000</code> — Title update (TU / patch)</li>
        <li><code>00000002</code> — DLC / marketplace content</li>
        <li><code>00040000</code> — Theme</li>
        <li><code>00008000</code> — Xbox Live Arcade game</li>
      </ul>

      <h2>Folder Structure — Real Hardware</h2>
      <pre><code>USB Drive (FAT32) or HDD:
Content/
  0000000000000000/     ← offline / no-licence account
    4D5307E6/           ← Title ID (e.g. Halo 3)
      000B0000/         ← Title update
        &lt;TU package&gt;
      00000002/         ← DLC
        &lt;DLC package 1&gt;
        &lt;DLC package 2&gt;</code></pre>
      <p>
        The console scans this structure on startup and when a game is launched. Updates are
        applied automatically; DLC is registered and appears in-game menus.
      </p>

      <h2>Installing DLC on a Modded Console</h2>
      <ol>
        <li>Download the DLC STFS package from <a href="/">xbx.place</a> (open the game page and look for DLC entries).</li>
        <li>Find the Title ID for the game — visible on the xbx.place game page or in the file metadata.</li>
        <li>On your USB drive or HDD, create the path:<br><code>Content/0000000000000000/&lt;TitleID&gt;/00000002/</code></li>
        <li>Place the DLC file (no extension) inside that folder.</li>
        <li>Safely eject and plug the drive into your modded Xbox 360.</li>
        <li>Launch the game — DLC should appear automatically in the in-game store or content menu.</li>
      </ol>

      <h2>Installing Title Updates on a Modded Console</h2>
      <ol>
        <li>Download the title update package from xbx.place.</li>
        <li>Create the path: <code>Content/0000000000000000/&lt;TitleID&gt;/000B0000/</code></li>
        <li>Place the update file inside that folder.</li>
        <li>Launch the game — the update is applied automatically before the title loads.</li>
      </ol>
      <p>
        <strong>Tip:</strong> Only one title update can be active at a time per title. If you place
        multiple TU files, the console uses the one with the highest version number.
      </p>
      <div class="stats">
        <span class="stat"><strong>000B0000</strong> title updates</span>
        <span class="stat"><strong>00000002</strong> DLC packages</span>
        <span class="stat"><strong>One TU active</strong> at a time</span>
      </div>

      <h2>Installing DLC in Xenia</h2>
      <p>
        Xenia uses the same <code>Content/</code> folder structure. By default, look for
        (or create) a <code>content/</code> folder inside the Xenia directory:
      </p>
      <pre><code>xenia/
  content/
    &lt;TitleID&gt;/
      00000002/
        &lt;DLC file&gt;
      000B0000/
        &lt;TU file&gt;</code></pre>
      <p>
        Restart Xenia or relaunch the game after placing files. Not all DLC is compatible with
        every Xenia build — check the Xenia compatibility notes for that title.
      </p>

      <h2>Finding DLC on xbx.place</h2>
      <p>
        Every game page on xbx.place lists linked DLC and title updates below the main download.
        You can also browse the <a href="/xbox-360-dlc.html">DLC catalog</a> to search across
        all add-on content. Each DLC entry shows the content type, file size, and a download link.
      </p>

      <h2>FAQ</h2>
      <dl>
        <dt>Does DLC require an Xbox Live account on a modded console?</dt>
        <dd>Using the <code>0000000000000000</code> account folder bypasses licence checks, so no Xbox Live account is required on a JTAG/RGH console.</dd>
        <dt>Can I use DLC with a disc copy of a game?</dt>
        <dd>Yes — as long as the Title ID matches, DLC stored on the USB or HDD will be detected regardless of whether the game itself is a disc or a GOD install.</dd>
        <dt>Why isn't my DLC showing up in-game?</dt>
        <dd>Double-check the folder path and Title ID. Some DLC requires the base game to be at a specific title update version. Installing the correct TU first usually fixes this.</dd>
      </dl>
      <a class="cta" href="/xbox-360-dlc.html">Browse DLC catalog</a>
      ${guideFooter("how-dlc-works-on-360")}`,
  });

  // ── guides/iso-to-god-usb.html ─────────────────────────────────────────────
  const isoToGodPage = pageShell({
    title: "How to Convert ISO to GOD & Install to USB for Xbox 360 | xbx.place",
    description:
      "Step-by-step guide to converting an Xbox 360 ISO to GOD format and installing it to a USB drive for use on a JTAG or RGH modded console.",
    canonical: `${BASE}/guides/iso-to-god-usb.html`,
    jsonLd: [
      faqJsonLd([
        {
          q: "How do I convert an Xbox 360 ISO to GOD format?",
          a: "Use ISO2GOD (Windows) or a compatible tool to convert the ISO into STFS containers, then place them in Content/0000000000000000/<TitleID>/00007000/ on your USB drive.",
        },
        {
          q: "What USB format does Xbox 360 use?",
          a: "Xbox 360 requires USB drives formatted as FAT32. Use a tool like Rufus or fat32format for drives larger than 32 GB.",
        },
        {
          q: "Does the USB drive need to be configured in the Xbox 360 dashboard?",
          a: "Yes — plug in the USB drive and go to System > Storage > USB Storage Device and select 'Configure Now' to let the console allocate storage space.",
        },
      ]),
    ],
    body: `
      <h1>How to Convert ISO to GOD & Install to USB</h1>
      <p class="lead">
        Downloaded an Xbox 360 ISO and want to play it on your modded console from a USB drive?
        This guide covers everything — from formatting the drive to launching the game from
        Freestyle Dash or Aurora.
      </p>
      <div class="stats">
        <span class="stat"><strong>JTAG / RGH</strong> required</span>
        <span class="stat"><strong>FAT32</strong> USB format</span>
        <span class="stat"><strong>ISO2GOD</strong> conversion tool</span>
      </div>

      <h2>What You Need</h2>
      <ul>
        <li>A JTAG or RGH modded Xbox 360</li>
        <li>A USB drive (8 GB minimum; 32 GB+ recommended for multiple games)</li>
        <li>An Xbox 360 ISO — download from the <a href="/">xbx.place catalog</a></li>
        <li><strong>ISO2GOD</strong> — free Windows tool for ISO → GOD conversion</li>
        <li><strong>Freestyle Dash</strong> or <strong>Aurora</strong> installed on the console</li>
      </ul>

      <h2>Step 1 — Format the USB Drive as FAT32</h2>
      <p>
        Xbox 360 only reads USB storage formatted as <strong>FAT32</strong>. Windows can only
        format FAT32 natively up to 32 GB — for larger drives use a third-party tool.
      </p>
      <ol>
        <li>Download <strong>Rufus</strong> (free) or <strong>fat32format</strong>.</li>
        <li>Select your USB drive, choose FAT32, and format.</li>
        <li>No special label or partition scheme is required — just plain FAT32.</li>
      </ol>
      <p>
        <strong>Note:</strong> Xbox 360 will only use up to 32 GB of a USB drive's capacity
        regardless of the actual drive size, split across two 16 GB partitions internally.
        All GOD content still lives in the visible FAT32 partition you manage on your PC.
      </p>

      <h2>Step 2 — Configure the USB Drive on Xbox 360</h2>
      <ol>
        <li>Plug the formatted USB drive into your Xbox 360 while it is on.</li>
        <li>Go to <strong>My Xbox → System Settings → Storage</strong>.</li>
        <li>Select the USB Storage Device and choose <strong>Configure Now</strong>.</li>
        <li>The console formats a small 512 MB system partition on the drive. The rest remains accessible from your PC.</li>
      </ol>
      <p>This step is optional for GOD content launched via Freestyle Dash / Aurora — many setups skip it and read directly from FAT32.</p>

      <h2>Step 3 — Download the ISO</h2>
      <p>
        Find the game on <a href="/">xbx.place</a>, open the game page, and download the ISO.
        Extract any archive (<code>.zip</code>, <code>.7z</code>, <code>.rar</code>) with
        <a href="https://www.7-zip.org/">7-Zip</a> to get the raw <code>.iso</code> file.
      </p>
      <p>
        Not sure which format to grab? See <a href="/guides/redump-vs-iso.html">Redump vs ISO</a>
        for an explanation of the different dump types available.
      </p>

      <h2>Step 4 — Convert ISO to GOD with ISO2GOD</h2>
      <ol>
        <li>Download and run <strong>ISO2GOD</strong>.</li>
        <li>Click the folder icon next to <em>Input</em> and select your <code>.iso</code> file.</li>
        <li>Set the <em>Output</em> folder to somewhere on your PC (e.g. a temp folder).</li>
        <li>Leave <em>Title ID</em> and <em>Media ID</em> on <strong>Auto</strong> — ISO2GOD reads these from the ISO header.</li>
        <li>Set <em>Base folder</em> to <code>0000000000000000</code> (the offline account ID used to bypass licence checks on modded consoles).</li>
        <li>Click <strong>Convert</strong> and wait. Large games may take several minutes.</li>
      </ol>
      <p>
        ISO2GOD will produce a folder structure like:
      </p>
      <pre><code>Output/
  0000000000000000/
    &lt;TitleID&gt;/
      00007000/
        &lt;data file 1&gt;
        &lt;data file 2&gt;   ← only if game is split</code></pre>

      <h2>Step 5 — Copy to USB Drive</h2>
      <ol>
        <li>On your USB drive, create a folder named <code>Content</code> at the root (if it doesn't exist).</li>
        <li>Copy the <code>0000000000000000</code> folder (and everything inside it) into <code>Content/</code>.</li>
        <li>Final path on the USB drive should be:<br><code>Content/0000000000000000/&lt;TitleID&gt;/00007000/&lt;files&gt;</code></li>
      </ol>
      <p>Safely eject the drive from your PC after the copy completes.</p>

      <h2>Step 6 — Launch on the Modded Console</h2>
      <ol>
        <li>Plug the USB drive into your Xbox 360.</li>
        <li>Boot into <strong>Freestyle Dash</strong> or <strong>Aurora</strong>.</li>
        <li>Add the USB drive as a game scan path if you haven't already (<em>Settings → File Manager → Add Path</em> in FSD).</li>
        <li>Scan for games — the title should appear with cover art if your dashboard has cover scraping enabled.</li>
        <li>Select and launch the game.</li>
      </ol>

      <h2>Adding DLC and Title Updates</h2>
      <p>
        Once the game is installed, you can add DLC and title updates to the same
        <code>Content/</code> tree on the USB drive. See the
        <a href="/guides/how-dlc-works-on-360.html">How DLC Works on Xbox 360</a> guide for
        folder paths and placement details.
      </p>

      <h2>Troubleshooting</h2>
      <dl>
        <dt>The game appears in Freestyle Dash but fails to launch</dt>
        <dd>Usually a bad conversion or a corrupt ISO. Re-download the ISO and re-run ISO2GOD. Check that the Title ID folder name matches the game's actual Title ID.</dd>
        <dt>ISO2GOD says "invalid ISO" or can't read the file</dt>
        <dd>The ISO may be trimmed or non-standard. Try a different source — Redump-aligned dumps are most reliable. See <a href="/guides/redump-vs-iso.html">Redump vs ISO</a>.</dd>
        <dt>USB drive not detected by the console</dt>
        <dd>Reformat as FAT32. Some drives require Y-cables or a powered hub for sufficient current. Try a different USB port on the console.</dd>
        <dt>Game launches but freezes or shows artifacts</dt>
        <dd>Install the latest title update for that game. Download it from the game's xbx.place page and place it at <code>Content/0000000000000000/&lt;TitleID&gt;/000B0000/</code>.</dd>
      </dl>
      <a class="cta" href="/">Browse Xbox 360 ROMs</a>
      ${guideFooter("iso-to-god-usb")}`,
  });

  // ── guides/index.html — hub page ───────────────────────────────────────────
  const guideCards = GUIDES.map(
    (g) => `
        <a class="guide-card" href="/guides/${g.slug}.html">
          <span class="guide-tag">${escapeHtml(g.tag)}</span>
          <h2 class="guide-card-title">${escapeHtml(g.title)}</h2>
          <p class="guide-card-desc">${escapeHtml(g.description)}</p>
          <span class="guide-card-read">Read guide →</span>
        </a>`
  ).join("\n");

  const guidesIndexPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Xbox 360 Guides — Formats, Emulation & Modding | xbx.place</title>
    <meta name="description" content="Step-by-step Xbox 360 guides covering Xenia emulation, ISO and GOD formats, DLC installation, and converting games for a modded console." />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="canonical" href="${BASE}/guides/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="xbx.place" />
    <meta property="og:title" content="Xbox 360 Guides — Formats, Emulation &amp; Modding | xbx.place" />
    <meta property="og:description" content="Step-by-step Xbox 360 guides covering Xenia emulation, ISO and GOD formats, DLC installation, and converting games for a modded console." />
    <meta property="og:url" content="${BASE}/guides/" />
    <meta property="og:image" content="${DEFAULT_OG}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${DEFAULT_OG}" />
    <style>
      body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#101010;color:#e8e8e8;line-height:1.65}
      h1,h2,h3{color:#fff}
      h1{font-size:clamp(1.5rem,4vw,2.1rem);line-height:1.2;margin-bottom:8px}
      a{color:#5fdb5f}
      .site-header{max-width:1100px;margin:0 auto;padding:28px 24px 0}
      .site-header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-size:1.15rem;font-weight:600}
      .site-header img{width:32px;height:32px;object-fit:contain;display:block}
      main{max-width:1100px;margin:0 auto;padding:48px 24px 64px}
      .page-lead{color:#aaa;font-size:1.02rem;margin:0 0 40px}
      .guide-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
      .guide-card{display:flex;flex-direction:column;gap:8px;padding:24px;background:#181818;border:1px solid #282828;border-radius:10px;text-decoration:none;color:inherit;transition:border-color .15s,background .15s}
      .guide-card:hover{background:#1f1f1f;border-color:#333}
      .guide-tag{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5fdb5f;background:#5fdb5f14;border:1px solid #5fdb5f28;padding:3px 9px;border-radius:999px;width:fit-content}
      .guide-card-title{font-size:1.1rem;font-weight:700;color:#fff;margin:0;line-height:1.3}
      .guide-card-desc{font-size:.88rem;color:#aaa;margin:0;flex:1}
      .guide-card-read{font-size:.82rem;color:#5fdb5f;margin-top:4px}
      .footer-links{margin-top:56px;padding-top:20px;border-top:1px solid #282828;font-size:.9rem}
      .footer-links a{color:#5fdb5f;margin-right:16px}
    </style>
  </head>
  <body>
    <header class="site-header">
      <a href="/"><img src="/logo.png" width="32" height="32" alt="" /><span>xbx.place</span></a>
    </header>
    <main>
      <h1>Xbox 360 Guides</h1>
      <p class="page-lead">Everything you need to download, format, and play Xbox 360 games — on emulators and modded hardware.</p>
      <div class="guide-grid">${guideCards}
      </div>
      <div class="footer-links">
        <a href="/">Catalog</a>
        <a href="/xbox-360-roms.html">Xbox 360 ROMs</a>
        <a href="/xbox-360-dlc.html">DLC</a>
        <a href="/about.html">About</a>
      </div>
    </main>
  </body>
</html>`;

  await writeFile(path.join(PUBLIC_DIR, "xbox-360-dlc.html"), dlcPage, "utf8");
  await mkdir(path.join(PUBLIC_DIR, "guides"), { recursive: true });
  await writeFile(path.join(PUBLIC_DIR, "guides/index.html"), guidesIndexPage, "utf8");
  await writeFile(path.join(PUBLIC_DIR, "guides/xenia-xbox-360-roms.html"), xeniaPage, "utf8");
  await writeFile(path.join(PUBLIC_DIR, "guides/redump-vs-iso.html"), redumpPage, "utf8");
  await writeFile(path.join(PUBLIC_DIR, "guides/god-format.html"), godPage, "utf8");
  await writeFile(path.join(PUBLIC_DIR, "guides/how-dlc-works-on-360.html"), dlcGuidePage, "utf8");
  await writeFile(path.join(PUBLIC_DIR, "guides/iso-to-god-usb.html"), isoToGodPage, "utf8");
  console.log("Wrote xbox-360-dlc.html, guides/index.html, and 5 guide pages");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
