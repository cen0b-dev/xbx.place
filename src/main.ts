import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";
import { initAuth, isAuthenticated } from "./auth";
import { initScrollLock } from "./scroll-lock";
import {
  authModalMarkup,
  bindAuthUi,
  closeProfilePage,
  openAuthModal,
  openPublicProfileByGamertag,
  syncHeaderAccountPlacement,
  syncProfileRouteFromUrl
} from "./auth-ui";
import {
  bindCollectionUi,
  closeCollectionModal,
  setActiveGameForCollections,
  syncGameCollectionButton
} from "./collections-ui";
import {
  bindCollectionDetailUi,
  closeCollectionDetail,
  openCollectionDetail,
  setCollectionDetailTitleIndex,
  syncCollectionRouteFromUrl
} from "./collection-detail-ui";
import {
  renderCollectionsDiscoverGrid,
  setCollectionsDiscoverError,
  setCollectionsDiscoverLoading
} from "./collections-browse";
import { loadDiscoverPublicCollections, type DiscoverCollection } from "./collections";
import { bindCommentsUi, setActiveGameForComments } from "./comments-ui";
import {
  bindDownloadCountdownUi,
  cancelDownloadCountdown,
  downloadCountdownPanelMarkup,
  GUEST_COUNTDOWN_SECONDS,
  runDownloadCountdown,
  SIGNED_IN_COUNTDOWN_SECONDS
} from "./download-countdown";
import { discordFooterLinkMarkup, discordHeroLinkMarkup, discordPromoStripMarkup } from "./discord";
import {
  bindGuestDownloadGateUi,
  guestDownloadGateMarkup,
  openGuestDownloadGate
} from "./guest-download-gate";
import { bindCommentReportUi, closeCommentReportUi, commentReportMarkup } from "./comment-report";
import { bindGameReportUi, closeGameReportUi, gameReportMarkup } from "./game-report";
import { bindCroppedCover, preloadCroppedCover } from "./cover-crop";
import { bgUrl, coverUrl, loadTitles, syncGameModalBackground } from "./data";
import { formatDownloadDisplay } from "./download-label";
import { startMinervaTorrentDownload } from "./minerva-torrent";
import { requestDownloadWithPool } from "./downloads";
import { initProxyPool } from "./proxy-pool";
import { galleryImageUrl } from "./gallery-image";
import {
  ADDON_TYPE_FILTERS,
  addonPackageSummary,
  addonTypeLabel,
  countAddonDownloads,
  isAddonTypeSlug,
  matchesAddonTypeFilter,
  readAddonTypeFromUrl,
  syncAddonTypeToUrl,
  titleHasAddonType,
  type AddonTypeSlug
} from "./addon-browse";
import {
  ADDON_SORT_OPTIONS,
  bindFormControlGlobals,
  dropdownMarkup,
  getDropdownValue,
  initFormControls,
  mountDropdown,
  REGION_OPTIONS,
  replaceDropdownOptions,
  setDropdownValue,
  SORT_OPTIONS
} from "./form-controls";
import { communityScoreBadgeHtml, createAddonListCard, createGridCard, createHeroCard, stars } from "./browse-card";
import { pickHeroVisualTitles } from "./featured-titles";
import { orderPackageDownloads } from "./update-version";
import {
  GENRE_FILTERS,
  genreLabel,
  matchesGenreFilter,
  readGenreFromUrl,
  syncGenreToUrl
} from "./genres";
import { readSearchFromUrl, syncSearchToUrl } from "./search-url";
import {
  DEFAULT_OG_IMAGE,
  applyRobotsMeta,
  gamePagePath,
  genrePagePath,
  loadGameSlugs,
  readGameIdFromUrl,
  syncGameToUrl
} from "./seo-url";
import { observeReveal, observeRevealChildren, observeRevealFirstRow } from "./reveal";
import type { DownloadEntry, TitleEntry } from "./types";

type Category = "Game" | "DLC" | "Collections";

type Settings = {
  th: string;
  r: string;
};

const THEME_COLORS = ["#107C10", "#0078D7", "#E81123", "#881798", "#FFB900"];
const SITE_NAME = "xbx.place";
const DEFAULT_TITLE = "Xbox 360 ROMs & ISO Downloads — 1,800+ Games | xbx.place";
const DEFAULT_DESCRIPTION =
  "Download Xbox 360 ROMs and ISOs free. Search 1,800+ games, DLC, and title updates with cover art and ratings. ISO and XEX formats — Redump-aligned catalog.";
const BASE_URL = import.meta.env.BASE_URL;


const root = document.querySelector<HTMLDivElement>("#app");

let db: TitleEntry[] = [];
let filtered: TitleEntry[] = [];
let loadedCount = 0;
let isLoadingMore = false;
let gridObserver: IntersectionObserver | null = null;
let category: Category = "Game";
let activeGenre: string | null = null;
let activeAddonType: AddonTypeSlug = "all";
let activeGame: TitleEntry | null = null;
let discoverCollections: DiscoverCollection[] = [];
let discoverCollectionsLoaded = false;
let discoverCollectionsLoading = false;
const ROWS_PER_BATCH = 5;
const settings: Settings = {
  th: window.localStorage.getItem("x_th") ?? "#107C10",
  r: window.localStorage.getItem("x_r") ?? "all"
};
function getGridColumnCount(grid: HTMLElement): number {
  const template = getComputedStyle(grid).gridTemplateColumns;
  const fromTemplate = template.split(" ").filter((col) => col.trim().length > 0).length;
  if (fromTemplate > 0) return fromTemplate;

  const gridStyle = getComputedStyle(grid);
  const minVar = gridStyle.getPropertyValue("--grid-col-min").trim();
  const minCol =
    parseFloat(minVar) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--t-w")) || 170;
  const gap = parseFloat(gridStyle.columnGap || gridStyle.gap || "20") || 20;
  const width = grid.clientWidth || grid.parentElement?.clientWidth || 0;
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCol + gap)));
}

function batchSize(grid: HTMLElement): number {
  if (category === "DLC") return 40;
  return Math.max(1, getGridColumnCount(grid) * ROWS_PER_BATCH);
}

function catalogCardSelector(): string {
  return category === "DLC" ? ".addon-list-card" : ".browse-card";
}

function syncCatalogGridLayout(): void {
  document.getElementById("grid")?.classList.toggle("browse-grid--addons", category === "DLC");
}

function stickyHeaderOffset(): number {
  const header = document.querySelector<HTMLElement>(".header");
  return (header?.getBoundingClientRect().height ?? 0) + 16;
}

/** Scroll so `element` sits just below the sticky header without overshooting. */
function scrollBelowHeader(element: HTMLElement | null): void {
  if (!element) return;
  const offset = stickyHeaderOffset();
  const top = element.getBoundingClientRect().top;
  if (top >= offset - 4 && top <= offset + 32) return;
  const target = element.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
}

async function handleDownload(filename: string, button?: HTMLButtonElement): Promise<void> {
  if (button) {
    button.disabled = true;
    button.classList.add("busy");
  }
  try {
    const countdownSeconds = isAuthenticated() ? SIGNED_IN_COUNTDOWN_SECONDS : GUEST_COUNTDOWN_SECONDS;
    const downloadPromise = requestDownloadWithPool(filename, { deferNavigation: true });
    const proceed = await runDownloadCountdown(filename, countdownSeconds);
    if (!proceed) return;

    const result = await downloadPromise;
    if (result.status === "auth_required") {
      openGuestDownloadGate(result.reason, result.activeFilename);
      return;
    }
    if (result.status === "blocked") {
      showDownloadNotice(result.message, true);
      return;
    }
    if (result.redirectUrl) {
      window.location.assign(result.redirectUrl);
    }
    showDownloadNotice("Download started. Open your browser downloads (Chrome: ⌘+Shift+J). Large X360 files can take a while to appear.", false);
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("busy");
    }
  }
}

async function handleTorrentDownload(
  dl: DownloadEntry,
  button?: HTMLButtonElement
): Promise<void> {
  if (button) {
    button.disabled = true;
    button.classList.add("busy");
  }
  try {
    const result = await startMinervaTorrentDownload(dl.filename, dl.fastUrl);
    if (!result.ok) {
      showDownloadNotice(result.error, true);
      return;
    }
    showDownloadNotice("Download started.", false);
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("busy");
    }
  }
}

function downloadTypeLabel(dl: DownloadEntry): string {
  if (dl.type === "Update") return "UPDATE";
  if (dl.type === "DLC") return "ADD-ON";
  return (dl.type ?? "Game").toUpperCase();
}

function packageModalCopy(): { eyebrow: string; title: string; section: string; empty: string } {
  if (activeAddonType === "update") {
    return {
      eyebrow: "Title update",
      title: "Choose an update",
      section: "Available updates",
      empty: "No title updates available for this game."
    };
  }
  if (activeAddonType === "dlc") {
    return {
      eyebrow: "DLC & add-on",
      title: "Choose a package",
      section: "Available DLC",
      empty: "No DLC packs available for this game."
    };
  }
  return {
    eyebrow: "Packages",
    title: "Choose a file",
    section: "Available packages",
    empty: "No downloadable packages available for this game."
  };
}

let downloadNoticeTimer = 0;

function showDownloadNotice(message: string, isError = false): void {
  let notice = document.getElementById("download-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "download-notice";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.className = isError ? "download-notice error show" : "download-notice show";
  window.clearTimeout(downloadNoticeTimer);
  downloadNoticeTimer = window.setTimeout(() => {
    notice?.classList.remove("show");
  }, 6000);
}

function gameBackgroundUrl(entry: TitleEntry): string {
  return bgUrl(entry);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSkeletonTiles(): void {
  const grid = document.getElementById("grid");
  if (!grid) return;
  syncCatalogGridLayout();
  if (category === "DLC") {
    grid.innerHTML = Array.from(
      { length: 12 },
      () => '<div class="skel-addon-row" aria-hidden="true"></div>'
    ).join("");
    return;
  }
  let html = "";
  for (let i = 0; i < 20; i += 1) {
    html += '<div class="browse-card is-loading skeleton"><div class="browse-card-media cover-crop-view"></div><div class="browse-card-ov"></div></div>';
  }
  grid.innerHTML = html;
}

function formatReleaseDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function gameBackLabel(): string {
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
  if (query) return "Back to Search Results";
  if (activeGenre) return `Back to ${genreLabel(activeGenre)}`;
  return "Back to Browse";
}

function syncGameBackLabel(): void {
  const label = document.getElementById("game-back-label");
  if (label) label.textContent = gameBackLabel();
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });
}

function gamePageSkeletonMarkup(): string {
  return `
    <div class="game-page-layout">
      <aside class="game-page-sidebar">
        <div class="skel-cover"></div>
        <div class="skel-actions">
          <div class="skel-line skel-line--btn"></div>
          <div class="skel-line skel-line--btn"></div>
          <div class="skel-line skel-line--btn" style="width:44px"></div>
        </div>
      </aside>
      <main class="game-page-main">
        <div class="game-page-head">
          <div class="skel-line skel-line--title"></div>
        </div>
        <div class="game-page-rating game-page-rating--skel">
          <div class="skel-line skel-line--score"></div>
          <div class="skel-line skel-line--short"></div>
        </div>
        <div class="skel-tags">
          <div class="skel-tag"></div>
          <div class="skel-tag"></div>
          <div class="skel-tag"></div>
        </div>
        <div class="skel-line skel-line--full"></div>
        <div class="skel-line skel-line--full"></div>
        <div class="skel-line skel-line--medium"></div>
        <div class="skel-meta">
          <div class="skel-meta-item"><div class="skel-meta-label"></div><div class="skel-meta-value"></div></div>
          <div class="skel-meta-item"><div class="skel-meta-label"></div><div class="skel-meta-value"></div></div>
          <div class="skel-meta-item"><div class="skel-meta-label"></div><div class="skel-meta-value"></div></div>
          <div class="skel-meta-item"><div class="skel-meta-label"></div><div class="skel-meta-value"></div></div>
        </div>
        <div class="skel-section">
          <div class="skel-section-title"></div>
          <div class="skel-media-row">
            <div class="skel-media-card"></div>
            <div class="skel-media-card"></div>
            <div class="skel-media-card"></div>
          </div>
        </div>
        <div class="skel-section">
          <div class="skel-section-title"></div>
          <div class="skel-media-row">
            <div class="skel-rec-card"></div>
            <div class="skel-rec-card"></div>
          </div>
        </div>
      </main>
    </div>
  `;
}

function renderShell(): void {
  if (!root) throw new Error("Missing app root");
  const aboutHref = `${BASE_URL}about.html`;
  const dmcaHref = `${BASE_URL}dmca.html`;
  const romsHref = `${BASE_URL}xbox-360-roms.html`;
  const dlcHref = `${BASE_URL}xbox-360-dlc.html`;
  const xeniaGuideHref = `${BASE_URL}guides/xenia-xbox-360-roms.html`;
  const pressHref = `${BASE_URL}press.html`;
  const genreFooterLinks = GENRE_FILTERS.slice(0, 6)
    .map((filter) => `<a href="${BASE_URL}${genrePagePath(filter.slug).replace(/^\//, "")}">${filter.label}</a>`)
    .join("");
  root.innerHTML = `
    <div id="btt"><i class="fa-solid fa-arrow-up"></i></div>
    <header class="header">
      <div class="top-bar">
        <div class="brand" id="brand-home" role="button" tabindex="0" aria-label="Back to browse">
          <img class="brand-logo" src="${BASE_URL}logo.png" width="36" height="36" alt="" />
          <div class="brand-name" id="brand-name">xbx.<span>place</span></div>
        </div>
        <div class="header-account account-menu-host" id="header-account-fallback"></div>
      </div>
      <div class="nav-row browse-only">
        <div class="pivots">
          <div class="pivot active" id="p-Game">GAMES</div>
          <div class="pivot" id="p-DLC">ADDONS & DLC</div>
          <div class="pivot" id="p-Collections">COLLECTIONS</div>
        </div>
        <div class="nav-search-group">
          <div class="nav-search">
            <div class="nav-search-field">
              <i class="fa-solid fa-magnifying-glass nav-search-icon" aria-hidden="true"></i>
              <input id="q" class="nav-search-inp" type="text" placeholder="Search..." aria-label="Search games" autocomplete="off" spellcheck="false" />
              <button type="button" class="nav-search-clear hidden" id="search-clear" aria-label="Clear search">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <div class="header-account account-menu-host" id="header-account-browse">
            <button class="account-trigger account-trigger--guest" id="auth-control" type="button" style="display:none">
              <span class="account-trigger-icon" aria-hidden="true"><i class="fa-solid fa-user"></i></span>
              <span class="account-trigger-label">Sign In</span>
            </button>
            <div class="account-menu hidden" id="account-menu" role="dialog" aria-label="Account" aria-modal="false"></div>
          </div>
        </div>
      </div>
    </header>
    <div class="browse-page" id="browsePage">
      <div class="browse-page-shell">
        <section class="site-hero" id="siteHero" aria-label="About xbx.place">
          <div class="site-hero-bg" aria-hidden="true">
            <div class="site-hero-slides" id="siteHeroSlides"></div>
            <div class="site-hero-bg-shade"></div>
            <div class="site-hero-glow"></div>
          </div>
          <div class="site-hero-inner">
            <div class="site-hero-copy">
              <span class="site-hero-eyebrow" id="siteHeroEyebrow">Xbox 360 ROMs & ISO</span>
              <h1 class="site-hero-title" id="siteHeroTitle">Download Xbox 360 Games, <span>DLC</span> & Updates</h1>
              <p class="site-hero-lead" id="siteHeroLead">Browse 1,800+ Xbox 360 ROMs and ISOs free — with cover art, ratings, DLC, title updates, and fast downloads via Xenia-compatible formats.</p>
              <div class="site-hero-stats">
                <span class="site-hero-stat" id="siteHeroGames"><strong>—</strong> games</span>
                <span class="site-hero-stat" id="siteHeroAddons"><strong>—</strong> add-ons</span>
              </div>
              <div class="site-hero-actions">
                <a class="btn site-hero-cta" id="siteHeroBrowse" href="#catalogSection">
                  <i class="fa-solid fa-compact-disc" aria-hidden="true"></i><span>Browse catalog</span>
                </a>
                ${discordHeroLinkMarkup()}
              </div>
            </div>
            <div class="site-hero-visual" aria-hidden="true">
              <div class="site-hero-covers" id="siteHeroCovers"></div>
            </div>
          </div>
        </section>
        <div class="browse-discovery catalog-only">
        <section class="browse-section browse-section--featured browse-section--rail games-only" id="featuredSection">
          <div class="browse-section-head">
            <div class="browse-section-title-block">
              <h2 class="game-section-title" id="featuredTitle">Top Rated</h2>
              <p class="browse-section-sub" id="featuredSubtitle">Ranked by community score</p>
            </div>
          </div>
          <div class="browse-hero-grid" id="hGrid"></div>
        </section>
        <section class="browse-section browse-section--genres games-only" id="genreSection">
          <div class="browse-section-head">
            <h2 class="game-section-title">Browse by Genre</h2>
          </div>
          <div class="genre-rail-scroll" id="genreRailScroll">
            <div class="genre-grid genre-grid--rail" id="genreRail" role="listbox" aria-label="Browse by genre"></div>
          </div>
        </section>
        <section class="browse-section browse-section--genres dlc-only hidden" id="addonTypeSection">
          <div class="browse-section-head">
            <div class="browse-section-title-block">
              <h2 class="game-section-title">Package Type</h2>
              <p class="browse-section-sub">Find DLC packs or title updates for your games</p>
            </div>
          </div>
          <div class="genre-rail-scroll" id="addonTypeRailScroll">
            <div class="genre-grid genre-grid--rail" id="addonTypeRail" role="listbox" aria-label="Filter by package type"></div>
          </div>
        </section>
        </div>
        <section class="browse-section browse-section--catalog catalog-only" id="catalogSection">
          <div class="browse-section-head">
            <div class="browse-section-title-group">
              <h2 class="game-section-title" id="lTitle">All Games</h2>
              <span class="browse-score-info-wrap games-only">
                <button type="button" class="browse-score-info" aria-describedby="scoreInfoTip">
                  <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                  <span>Community score</span>
                </button>
                <span id="scoreInfoTip" class="browse-score-tip" role="tooltip">Community ratings on a 0–100 scale, converted from 5-star scores.</span>
              </span>
            </div>
            <div class="browse-section-actions">
              <span id="cnt" class="browse-count"></span>
              <div class="browse-filter-drawer-host">
                <button
                  type="button"
                  class="browse-filter-trigger"
                  id="browseFilterToggle"
                  aria-expanded="false"
                  aria-controls="browseFilterDrawer"
                >
                  <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                  <span id="browseFilterLabel">Filters</span>
                </button>
                <div class="browse-filter-drawer hidden" id="browseFilterDrawer" role="dialog" aria-label="Browse filters">
                  <div class="browse-filter-drawer-head">
                    <h3 class="browse-filter-drawer-title" id="browseFilterDrawerTitle">Catalog filters</h3>
                    <button type="button" class="browse-filter-drawer-close" id="browseFilterClose" aria-label="Close filters">
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="browse-filter-drawer-body">
                    <div class="browse-filter-drawer-field">
                      <span class="browse-toolbar-label" id="browseSortLabel">Sort catalog</span>
                      ${dropdownMarkup("sort", SORT_OPTIONS, "rating", "ui-dropdown--block")}
                    </div>
                    <div class="browse-filter-drawer-field">
                      <span class="browse-toolbar-label" id="browseRegionLabel">Region</span>
                      ${dropdownMarkup("browseReg", REGION_OPTIONS, settings.r, "ui-dropdown--block")}
                    </div>
                  </div>
                  <div class="browse-filter-drawer-foot">
                    <button type="button" class="browse-filter-drawer-reset" id="browseFilterReset">Reset filters</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="browse-filter-bar hidden" id="browseFilterBar" aria-live="polite"></div>
          <div class="browse-grid" id="grid"></div>
          <div id="gridSentinel" class="browse-grid-sentinel" aria-hidden="true"></div>
          <div id="pager" class="browse-pager"></div>
        </section>
        <section class="browse-section browse-section--collections collections-only hidden" id="collectionsSection">
          <div class="browse-section-head">
            <div class="browse-section-title-block">
              <h2 class="game-section-title">Public Collections</h2>
              <p class="browse-section-sub">Tap a list to browse games, read notes, and join the conversation</p>
            </div>
            <span id="collectionsCnt" class="browse-count"></span>
          </div>
          <div id="collectionsDiscoverStatus" class="collections-discover-status hidden" role="status"></div>
          <div id="collectionsDiscoverGrid" class="collections-discover-grid"></div>
        </section>
      </div>
    </div>
    <div class="overlay overlay--fit" id="setMod">
      <div class="game-modal game-modal--ambient game-modal--compact">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-settings" type="button" aria-label="Close preferences">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Site</div>
            <h2 class="game-modal-title">Preferences</h2>
            <p class="game-modal-sub">Customize how xbx.place looks and which games appear in your catalog.</p>
          </header>
          <section class="game-modal-section">
            <h3 class="game-section-title">Options</h3>
            <p class="game-modal-lead">Saved on this device and applied across browse, game details, and downloads.</p>
            <div class="settings-options">
              <div class="settings-option-row">
                <div class="settings-option-copy">
                  <span class="settings-option-label">Theme accent</span>
                  <span class="settings-option-hint">Color for buttons, links, and active states.</span>
                </div>
                <div class="settings-option-control">
                  <div class="swatches" id="thPick" role="group" aria-label="Theme accent color"></div>
                </div>
              </div>
              <div class="settings-option-row">
                <div class="settings-option-copy">
                  <span class="settings-option-label">Default region</span>
                  <span class="settings-option-hint">Filter featured titles and the catalog by region.</span>
                </div>
                <div class="settings-option-control settings-option-control--dropdown">
                  ${dropdownMarkup("reg", REGION_OPTIONS, "all", "ui-dropdown--block")}
                </div>
              </div>
            </div>
          </section>
          <div class="game-modal-footer">
            <button class="btn game-modal-footer-primary" id="save-settings" type="button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>Save preferences</span></button>
          </div>
          </div>
        </div>
      </div>
    </div>
    <div id="collectionPage" class="collection-page hidden" aria-hidden="true">
      <div class="collection-page-bg" aria-hidden="true">
        <div class="collection-page-bg-shade"></div>
      </div>
      <div class="game-page-shell">
        <button class="game-back-link" id="close-collection-detail" type="button">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back to Browse</span>
        </button>
        <div class="collection-page-content" id="collection-detail-content">
          <header class="collection-page-head">
            <div class="collection-page-eyebrow">Collection</div>
            <h1 class="collection-page-title" id="collection-detail-title">Collection</h1>
            <p class="collection-page-description hidden" id="collection-detail-description"></p>
            <div class="collection-detail-meta">
              <button type="button" class="collection-detail-owner" id="collection-detail-owner">
                <img class="collection-detail-owner-pic" id="collection-detail-owner-pic" alt="" />
                <span>Player</span>
              </button>
              <span class="collection-detail-count" id="collection-detail-count"></span>
            </div>
            <div class="collection-detail-toolbar">
              <button type="button" class="btn btn-ghost collection-detail-share-btn" id="collection-detail-share">
                <i class="fa-solid fa-link" aria-hidden="true"></i><span>Copy link</span>
              </button>
              <p id="collection-detail-share-status" class="collection-detail-share-status hidden" role="status"></p>
            </div>
          </header>
          <div id="collection-detail-scroll" class="collection-page-body">
            <div id="collection-detail-games" class="browse-grid"></div>
            <h2 class="game-section-title" id="collection-detail-comments-title">Comments</h2>
            <div class="collection-detail-comments-wrap">
              <div id="collection-detail-comments-body" class="collection-detail-comments-body"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="gamePage" class="game-page hidden" aria-hidden="true">
      <div class="game-page-bg" aria-hidden="true">
        <img id="gp-bg" class="game-page-bg-img" alt="" />
        <div class="game-page-bg-shade"></div>
      </div>
      <div class="game-page-shell">
        <button class="game-back-link" id="close-game-page" type="button">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span id="game-back-label">Back to Browse</span>
        </button>
        <div class="game-page-stage">
          <div class="game-page-skeleton" id="gp-skeleton" aria-hidden="true">${gamePageSkeletonMarkup()}</div>
          <div class="game-page-content" id="gp-content">
            <div class="game-page-layout">
              <aside class="game-page-sidebar game-reveal-block">
                <div class="game-page-cover-wrap cover-crop-view is-loading" id="gp-cover-wrap">
                  <img id="gp-cover" class="game-page-cover" alt="" />
                </div>
                <div class="game-page-actions">
                  <button class="game-download-btn btn" id="gp-download-btn" type="button">
                    <i class="fa-solid fa-download" aria-hidden="true"></i><span>Download</span>
                  </button>
                  <div class="game-collection-split">
                    <button class="game-collection-main" id="gp-collection-btn" type="button">
                      <i class="fa-solid fa-bookmark" aria-hidden="true"></i><span>Add to collection</span>
                    </button>
                    <button class="game-collection-save" id="gp-collection-save-btn" type="button" aria-label="Quick add to collection">
                      <i class="fa-solid fa-plus" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="game-options-host">
                    <button class="game-details-btn" id="gp-details-btn" type="button" title="More options" aria-haspopup="menu" aria-expanded="false" aria-controls="gp-options-menu">
                      <i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>More options</span>
                    </button>
                    <div class="game-options-menu hidden" id="gp-options-menu" role="menu" aria-label="More options">
                      <button type="button" class="account-menu-action" id="gp-report-btn" role="menuitem">
                        <i class="fa-solid fa-flag" aria-hidden="true"></i><span>Report an issue</span>
                      </button>
                    </div>
                  </div>
                </div>
              </aside>
              <main class="game-page-main">
                <div class="game-page-head game-reveal-block">
                  <h1 id="gp-title" class="game-page-title"></h1>
                </div>
                <div class="game-page-rating game-reveal-block">
                  <div id="gp-score" class="game-page-score" aria-label="Community score"></div>
                  <div id="gp-rate" class="game-page-stars"></div>
                  <span class="game-page-year-sep" aria-hidden="true">·</span>
                  <span id="gp-yr" class="game-page-year"></span>
                </div>
                <div id="gp-tags" class="game-page-tags game-reveal-block"></div>
                <p id="gp-desc" class="game-page-desc game-reveal-block"></p>
                <div class="game-page-meta game-reveal-block">
                  <div class="game-meta-item">
                    <span class="game-meta-label">Developer</span>
                    <span id="gp-dev" class="game-meta-value"></span>
                  </div>
                  <div class="game-meta-item">
                    <span class="game-meta-label">Publisher</span>
                    <span id="gp-pub" class="game-meta-value"></span>
                  </div>
                  <div class="game-meta-item">
                    <span class="game-meta-label">Release Date</span>
                    <span id="gp-release" class="game-meta-value"></span>
                  </div>
                  <div class="game-meta-item">
                    <span class="game-meta-label">Regions</span>
                    <span id="gp-reg" class="game-meta-value"></span>
                  </div>
                </div>
                <section class="game-section game-reveal-block">
                  <h2 class="game-section-title">Media</h2>
                  <div id="gp-media" class="game-media-wrap"></div>
                </section>
                <section class="game-section game-reveal-block">
                  <h2 class="game-section-title">More like this</h2>
                  <div id="gp-rec" class="game-rec-wrap"></div>
                </section>
                <section class="game-section game-reveal-block" id="gp-comments-section">
                  <h2 class="game-section-title">Comments</h2>
                  <div id="gp-comments-body"></div>
                </section>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay overlay--fit" id="downloadMod">
      <div class="game-modal">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-download-mod" type="button" aria-label="Close downloads">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
          ${downloadCountdownPanelMarkup()}
          <div class="download-modal-content">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Download</div>
            <h2 class="game-modal-title">Choose a file</h2>
            <p id="download-mod-subtitle" class="game-modal-sub"></p>
          </header>
          <section class="game-modal-section">
            ${discordPromoStripMarkup()}
            <h3 class="game-section-title">Available files</h3>
            <div class="game-modal-panel game-modal-panel--download">
              <div id="dl-l" class="game-modal-list"></div>
            </div>
          </section>
          </div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay overlay--fit" id="packageMod">
      <div class="game-modal">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-package-mod" type="button" aria-label="Close packages">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
          ${downloadCountdownPanelMarkup()}
          <div class="download-modal-content">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow" id="package-mod-eyebrow">Packages</div>
            <h2 class="game-modal-title" id="package-mod-title">Choose a file</h2>
            <p id="package-mod-subtitle" class="game-modal-sub"></p>
          </header>
          <section class="game-modal-section">
            ${discordPromoStripMarkup()}
            <h3 class="game-section-title" id="package-mod-section-title">Available packages</h3>
            <div class="game-modal-panel game-modal-panel--download">
              <div id="package-l" class="game-modal-list"></div>
            </div>
          </section>
          </div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay overlay--fit" id="collectionMod">
      <div class="game-modal">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-collection-mod" type="button" aria-label="Close collections">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span id="collection-mod-back-label">Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow collection-mod-shell">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Collection</div>
            <h2 id="collection-mod-title" class="game-modal-title">Add to collection</h2>
            <p id="collection-mod-subtitle" class="game-modal-sub"></p>
          </header>
          <div id="collection-mod-pick-view" class="collection-mod-view">
            <section class="game-modal-section">
              <h3 class="game-section-title">Your collections</h3>
              <p class="collection-mod-lead">Select the lists you want this game saved to.</p>
              <div class="game-modal-panel collection-mod-panel">
                <div id="collection-mod-list" class="collection-mod-list hidden"></div>
              </div>
            </section>
            <div class="game-modal-footer collection-mod-footer">
              <button class="btn btn-ghost collection-mod-new-btn" id="collection-mod-new-btn" type="button">
                <i class="fa-solid fa-folder-plus" aria-hidden="true"></i><span>Create New Collection</span>
              </button>
              <button class="btn game-modal-footer-primary collection-mod-save-btn" id="collection-mod-save-btn" type="button" disabled>
                <i class="fa-solid fa-check" aria-hidden="true"></i><span>Add to collection</span>
              </button>
            </div>
          </div>
          <div id="collection-mod-create-view" class="collection-mod-view hidden">
            <section class="game-modal-section">
              <h3 class="game-section-title">New collection</h3>
              <p class="collection-mod-lead">Name a new list and choose whether it appears on your profile.</p>
              <div class="game-modal-panel collection-mod-panel">
                <div id="collection-mod-create"></div>
              </div>
            </section>
          </div>
          <div id="collection-mod-empty-view" class="collection-mod-view hidden">
            <section class="game-modal-section">
              <div class="game-modal-panel collection-mod-panel">
                <div id="collection-mod-empty" class="collection-mod-empty"></div>
                <div id="collection-mod-create-first"></div>
              </div>
            </section>
          </div>
          <div id="collection-mod-status" class="collection-mod-status hidden" role="status"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay" id="mediaLightbox" aria-hidden="true">
      <div class="game-media-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
        <button class="game-media-lightbox-close" id="close-media-lightbox" type="button" aria-label="Close screenshot viewer">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
        <button class="game-media-lightbox-nav game-media-lightbox-prev" id="media-lightbox-prev" type="button" aria-label="Previous screenshot">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        </button>
        <img id="media-lightbox-img" class="game-media-lightbox-img" alt="" />
        <button class="game-media-lightbox-nav game-media-lightbox-next" id="media-lightbox-next" type="button" aria-label="Next screenshot">
          <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
        </button>
        <div id="media-lightbox-caption" class="game-media-lightbox-caption"></div>
      </div>
    </div>
    ${authModalMarkup()}
    ${guestDownloadGateMarkup()}
    ${gameReportMarkup()}
    ${commentReportMarkup()}
    <footer class="footer">
      <div>
        <div class="footer-brand">
          <img class="footer-logo" src="${BASE_URL}logo.png" width="28" height="28" alt="" />
          <span class="footer-name">xbx.place</span>
        </div>
        <div>The premier archive for X360 content.</div>
      </div>
      <div class="footer-nav">
        <div class="footer-links">
          <a href="${aboutHref}">About</a><a href="${romsHref}">Xbox 360 ROMs</a><a href="${dlcHref}">DLC</a><a href="${xeniaGuideHref}">Xenia guide</a><a href="${pressHref}">Press</a>${discordFooterLinkMarkup()}<a href="${dmcaHref}">DMCA</a>
        </div>
        <div class="footer-genres">${genreFooterLinks}</div>
      </div>
    </footer>
  `;
}

function closeGamePage(push = true): void {
  closeDownloadModal();
  closePackageModal();
  closeCollectionModal();
  closeGameReportUi();
  closeCommentReportUi();
  activeGame = null;
  setActiveGameForCollections(null);
  setActiveGameForComments(null);
  document.body.classList.remove("game-view");
  syncHeaderAccountPlacement();
  const page = document.getElementById("gamePage");
  page?.classList.add("hidden");
  page?.classList.remove("game-page--loading", "game-page--ready");
  page?.setAttribute("aria-hidden", "true");
  if (push) {
    const url = new URL(window.location.href);
    url.searchParams.delete("title");
    if (url.searchParams.has("collection")) {
      window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } else if (activeGenre) {
      syncGenreToUrl(activeGenre, true);
    } else {
      window.history.pushState(null, "", `/${url.search}${url.hash}`);
    }
  }
  syncDefaultHead();
}

function closeDownloadModal(): void {
  cancelDownloadCountdown();
  document.getElementById("downloadMod")?.classList.remove("show");
}

function closePackageModal(): void {
  cancelDownloadCountdown();
  document.getElementById("packageMod")?.classList.remove("show");
}

function openDownloadModal(): void {
  if (!activeGame) return;
  const subtitle = document.getElementById("download-mod-subtitle");
  if (subtitle) subtitle.textContent = activeGame.name;
  syncGameModalBackground("downloadMod", activeGame);
  renderDownloadList(activeGame);
  document.getElementById("downloadMod")?.classList.add("show");
}

function openPackageModal(game: TitleEntry): void {
  const copy = packageModalCopy();
  const subtitle = document.getElementById("package-mod-subtitle");
  const eyebrow = document.getElementById("package-mod-eyebrow");
  const title = document.getElementById("package-mod-title");
  const sectionTitle = document.getElementById("package-mod-section-title");
  const packageCount = game.downloads.filter((dl) => matchesAddonTypeFilter(dl, activeAddonType) && dl.url).length;
  if (subtitle) subtitle.textContent = game.name;
  if (eyebrow) eyebrow.textContent = copy.eyebrow;
  if (title) title.textContent = copy.title;
  if (sectionTitle) {
    sectionTitle.textContent =
      packageCount > 0 ? `${copy.section} (${packageCount.toLocaleString()})` : copy.section;
  }
  syncGameModalBackground("packageMod", game);
  renderPackageList(game);
  document.getElementById("packageMod")?.classList.add("show");
}

function renderDownloadEntries(
  listEl: HTMLElement,
  downloads: DownloadEntry[],
  emptyMessage: string
): void {
  listEl.innerHTML = "";
  const items = downloads.filter((dl) => dl.url);
  if (!items.length) {
    listEl.innerHTML = `<div class="download-empty">${emptyMessage}</div>`;
    return;
  }

  for (const dl of items) {
    const display = formatDownloadDisplay(dl.label ?? dl.filename);
    const meta = display.meta ? `<div class="dl-meta">${display.meta}</div>` : "";
    const row = document.createElement("div");
    row.className = "dl-btn-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "dl-btn";
    button.innerHTML = `<div><div class="dl-type">${downloadTypeLabel(dl)}</div><b>${display.title}</b>${meta}</div><span><i class="fa-solid fa-download"></i></span>`;
    button.addEventListener("click", (event) => {
      void handleDownload(dl.filename, event.currentTarget as HTMLButtonElement);
    });

    row.append(button);
    if (dl.fastUrl) {
      const torrentBtn = document.createElement("button");
      torrentBtn.type = "button";
      torrentBtn.className = "dl-btn-side dl-btn-side--torrent";
      torrentBtn.title = "Faster download";
      torrentBtn.innerHTML = '<i class="fa-solid fa-magnet" aria-hidden="true"></i>';
      torrentBtn.addEventListener("click", (event) => {
        void handleTorrentDownload(dl, event.currentTarget as HTMLButtonElement);
      });
      row.append(torrentBtn);
    }
    listEl.appendChild(row);
  }
}

function renderDownloadList(game: TitleEntry): void {
  const dlList = document.getElementById("dl-l");
  if (!dlList) return;

  const items = (game.downloads ?? []).filter((dl) => dl.url);
  if (!items.length) {
    dlList.innerHTML = `<div class="download-empty">No downloads available for this title.</div>`;
    return;
  }

  const games = items.filter((dl) => dl.type === "Game" || !dl.type || dl.type === "ROM");
  const dlcs = items.filter((dl) => dl.type === "DLC");
  const updates = items.filter((dl) => dl.type === "Update");

  // If there are no DLCs or Updates, just render the list normally
  if (!dlcs.length && !updates.length) {
    renderDownloadEntries(dlList, games, "No downloads available for this title.");
    return;
  }

  dlList.innerHTML = "";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "tabs";
  tabsContainer.style.padding = "0";
  tabsContainer.style.marginTop = "0";
  tabsContainer.style.marginBottom = "16px";

  const contentContainer = document.createElement("div");

  const tabs: { label: string; items: DownloadEntry[]; empty: string }[] = [];
  if (games.length) tabs.push({ label: "Game", items: games, empty: "No game downloads available." });
  if (updates.length) tabs.push({ label: "Updates", items: orderPackageDownloads(updates, true), empty: "No updates available." });
  if (dlcs.length) tabs.push({ label: "DLC", items: orderPackageDownloads(dlcs, false), empty: "No DLC available." });

  tabs.forEach((tab, index) => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab ${index === 0 ? "active" : ""}`;
    tabEl.textContent = tab.label;
    tabsContainer.appendChild(tabEl);

    const contentEl = document.createElement("div");
    contentEl.className = `tab-c ${index === 0 ? "active" : ""}`;
    contentEl.style.padding = "0";
    
    const listContainer = document.createElement("div");
    listContainer.className = "game-modal-list";
    renderDownloadEntries(listContainer, tab.items, tab.empty);
    contentEl.appendChild(listContainer);
    
    contentContainer.appendChild(contentEl);

    tabEl.addEventListener("click", () => {
      Array.from(tabsContainer.children).forEach(c => c.classList.remove("active"));
      Array.from(contentContainer.children).forEach(c => c.classList.remove("active"));
      tabEl.classList.add("active");
      contentEl.classList.add("active");
    });
  });

  dlList.appendChild(tabsContainer);
  dlList.appendChild(contentContainer);
}

function renderPackageList(game: TitleEntry): void {
  const list = document.getElementById("package-l");
  if (!list) return;
  const downloads = game.downloads.filter((dl) => matchesAddonTypeFilter(dl, activeAddonType));
  const ordered = orderPackageDownloads(downloads, activeAddonType === "update" || activeAddonType === "all");
  renderDownloadEntries(list, ordered, packageModalCopy().empty);
}

function updateDownloadButton(game: TitleEntry): void {
  const button = document.getElementById("gp-download-btn") as HTMLButtonElement | null;
  if (!button) return;
  const hasDownloads = (game.downloads ?? []).some((dl) => dl.url);
  button.disabled = !hasDownloads;
  button.title = hasDownloads ? "Choose a file to download" : "No downloads available";
}

function renderGameTags(container: HTMLElement, game: TitleEntry): void {
  container.innerHTML = "";
  const platform = document.createElement("span");
  platform.className = "game-tag game-tag--platform";
  platform.innerHTML = '<i class="fa-brands fa-xbox" aria-hidden="true"></i> Xbox 360';
  container.appendChild(platform);
  for (const genre of (game.genre ?? []).slice(0, 4)) {
    const tag = document.createElement("span");
    tag.className = "game-tag game-tag--genre";
    tag.textContent = genre;
    container.appendChild(tag);
  }
}

function bindHorizontalScroll(container: HTMLElement, selector: string): () => void {
  const wrap = container.querySelector<HTMLElement>(".game-scroll-wrap");
  const track = container.querySelector<HTMLElement>(selector);
  const prev = container.querySelector<HTMLButtonElement>(".game-scroll-prev");
  const next = container.querySelector<HTMLButtonElement>(".game-scroll-next");
  if (!wrap || !track || !next) return () => {};

  const syncScrollFades = (): void => {
    const overflow = track.scrollWidth > track.clientWidth + 2;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    wrap.classList.toggle("has-overflow", overflow);
    wrap.classList.toggle("can-scroll-left", overflow && !atStart);
    wrap.classList.toggle("can-scroll-right", overflow && !atEnd);
  };

  const scheduleSync = (): void => {
    syncScrollFades();
    requestAnimationFrame(() => requestAnimationFrame(syncScrollFades));
  };

  const scrollStep = (): number => Math.max(280, track.clientWidth * 0.75);

  prev?.addEventListener("click", () => {
    track.scrollBy({ left: -scrollStep(), behavior: "smooth" });
  });
  next.addEventListener("click", () => {
    track.scrollBy({ left: scrollStep(), behavior: "smooth" });
  });
  track.addEventListener("scroll", syncScrollFades, { passive: true });
  window.addEventListener("resize", scheduleSync);

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(scheduleSync);
    ro.observe(track);
    for (const child of track.children) {
      if (child instanceof HTMLElement) ro.observe(child);
    }
  }

  scheduleSync();
  return scheduleSync;
}

let mediaLightboxImages: string[] = [];
let mediaLightboxIndex = 0;

function syncMediaLightbox(): void {
  const img = document.getElementById("media-lightbox-img") as HTMLImageElement | null;
  const caption = document.getElementById("media-lightbox-caption");
  const prev = document.getElementById("media-lightbox-prev");
  const next = document.getElementById("media-lightbox-next");
  const src = mediaLightboxImages[mediaLightboxIndex];
  if (!img || !src) return;
  img.src = src;
  img.alt = `Screenshot ${mediaLightboxIndex + 1} of ${mediaLightboxImages.length}`;
  if (caption) caption.textContent = `${mediaLightboxIndex + 1} / ${mediaLightboxImages.length}`;
  prev?.classList.toggle("hidden", mediaLightboxImages.length <= 1);
  next?.classList.toggle("hidden", mediaLightboxImages.length <= 1);
}

function openMediaLightbox(images: string[], index: number): void {
  mediaLightboxImages = images;
  mediaLightboxIndex = index;
  syncMediaLightbox();
  document.getElementById("mediaLightbox")?.classList.add("show");
}

function closeMediaLightbox(): void {
  document.getElementById("mediaLightbox")?.classList.remove("show");
}

function renderMediaStrip(container: HTMLElement, images: string[]): void {
  if (!images.length) {
    container.className = "game-media-wrap";
    container.innerHTML = '<p class="game-media-empty">No screenshots available.</p>';
    return;
  }

  container.className = "game-media-wrap is-loading";
  container.innerHTML = `
    <div class="game-media-skeleton" aria-hidden="true">
      <div class="skel-media-card"></div>
      <div class="skel-media-card"></div>
      <div class="skel-media-card"></div>
    </div>
    <div class="game-scroll-wrap" hidden>
      <button type="button" class="game-scroll-prev" aria-label="Scroll media left"><i class="fa-solid fa-chevron-left"></i></button>
      <div class="game-media-scroll"></div>
      <button type="button" class="game-scroll-next" aria-label="Scroll media right"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  `;
  const track = container.querySelector(".game-media-scroll");
  const scrollWrap = container.querySelector<HTMLElement>(".game-scroll-wrap");
  if (!track || !scrollWrap) return;

  let syncScroll: () => void = () => {};

  void preloadImage(galleryImageUrl(images[0] ?? "")).then(() => {
    scrollWrap.hidden = false;
    container.classList.remove("is-loading");
    container.classList.add("is-loaded");
    syncScroll();
  });

  images.forEach((src, index) => {
    const proxied = galleryImageUrl(src);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-media-card";
    button.setAttribute("aria-label", `View screenshot ${index + 1}`);
    const img = document.createElement("img");
    img.src = proxied;
    img.alt = `Screenshot ${index + 1}`;
    img.loading = "lazy";
    img.addEventListener("load", syncScroll, { once: true });
    const zoom = document.createElement("span");
    zoom.className = "game-media-card-zoom";
    zoom.setAttribute("aria-hidden", "true");
    zoom.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
    button.appendChild(img);
    button.appendChild(zoom);
    button.addEventListener("click", () => openMediaLightbox(images.map(galleryImageUrl), index));
    track.appendChild(button);
  });

  syncScroll = bindHorizontalScroll(container, ".game-media-scroll");
  syncScroll();
}

function renderGameRecommendations(container: HTMLElement, game: TitleEntry): void {
  const picks = similarTitles(game, 5);
  if (!picks.length) {
    container.className = "game-rec-wrap";
    container.innerHTML = '<p class="game-rec-empty">No similar titles found.</p>';
    return;
  }

  container.className = "game-rec-wrap is-loading";
  container.innerHTML = `
    <div class="game-rec-skeleton" aria-hidden="true">
      <div class="skel-rec-card"></div>
      <div class="skel-rec-card"></div>
    </div>
    <div class="game-scroll-wrap" hidden>
      <button type="button" class="game-scroll-prev" aria-label="Scroll recommendations left"><i class="fa-solid fa-chevron-left"></i></button>
      <div class="game-rec-scroll"></div>
      <button type="button" class="game-scroll-next" aria-label="Scroll recommendations right"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  `;
  const track = container.querySelector(".game-rec-scroll");
  const scrollWrap = container.querySelector<HTMLElement>(".game-scroll-wrap");
  if (!track || !scrollWrap) return;

  let syncScroll: () => void = () => {};

  void preloadImage(coverUrl(picks[0]!)).then(() => {
    scrollWrap.hidden = false;
    container.classList.remove("is-loading");
    container.classList.add("is-loaded");
    syncScroll();
  });

  for (const rec of picks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-rec-card";
    button.innerHTML = `
      <div class="game-rec-cover cover-crop-view">
        <img alt="" loading="lazy" />
      </div>
      <div class="game-rec-copy">
        <div class="game-rec-name"></div>
        <div class="game-rec-genre"></div>
      </div>
      ${communityScoreBadgeHtml(rec.rating, "browse-tile-score game-rec-score")}
    `;
    button.querySelector(".game-rec-name")!.textContent = rec.name;
    button.querySelector(".game-rec-genre")!.textContent = (rec.genre?.slice(0, 2) ?? ["Related title"]).join(" · ");
    const recCover = button.querySelector<HTMLImageElement>(".game-rec-cover img");
    if (recCover) {
      bindCroppedCover(recCover, coverUrl(rec), {
        fallbackSrc: `https://placehold.co/280x390/202020/ffffff.png?text=${encodeURIComponent(rec.name)}`,
        onReady: syncScroll
      });
    }
    button.addEventListener("click", () => openGamePage(rec));
    track.appendChild(button);
  }

  syncScroll = bindHorizontalScroll(container, ".game-rec-scroll");
  syncScroll();
}

function openGamePage(game: TitleEntry, push = true): void {
  closeDownloadModal();
  closePackageModal();
  closeCollectionModal();
  activeGame = game;
  setActiveGameForCollections(game);
  setActiveGameForComments(game);
  const title = document.getElementById("gp-title");
  const score = document.getElementById("gp-score");
  const desc = document.getElementById("gp-desc");
  const dev = document.getElementById("gp-dev");
  const pub = document.getElementById("gp-pub");
  const reg = document.getElementById("gp-reg");
  const release = document.getElementById("gp-release");
  const rate = document.getElementById("gp-rate");
  const year = document.getElementById("gp-yr");
  const cover = document.getElementById("gp-cover") as HTMLImageElement | null;
  const coverWrap = document.getElementById("gp-cover-wrap");
  const bg = document.getElementById("gp-bg") as HTMLImageElement | null;
  const tags = document.getElementById("gp-tags");
  const media = document.getElementById("gp-media");
  const recommendations = document.getElementById("gp-rec");
  const page = document.getElementById("gamePage");
  if (!title || !score || !desc || !dev || !pub || !reg || !release || !rate || !year || !cover || !coverWrap || !bg || !tags || !media || !recommendations || !page) return;

  page.classList.remove("hidden", "game-page--ready");
  page.classList.add("game-page--loading");
  document.body.classList.add("game-view");
  syncHeaderAccountPlacement();
  page.setAttribute("aria-hidden", "false");
  window.scrollTo({ top: 0, behavior: "auto" });

  coverWrap.classList.add("is-loading");
  coverWrap.classList.remove("is-loaded");
  cover.classList.remove("is-loaded");
  bg.classList.remove("is-loaded");

  title.textContent = game.name;
  score.innerHTML = communityScoreBadgeHtml(game.rating, "game-page-score-badge");
  desc.textContent = game.description ?? "No description available.";
  dev.textContent = game.developer ?? "—";
  pub.textContent = game.publisher ?? "—";
  reg.textContent = game.regions?.join(", ") || "—";
  release.textContent = formatReleaseDate(game.release_date);
  rate.innerHTML = stars(game.rating);
  year.textContent = game.release_date ? game.release_date.slice(0, 4) : "";

  renderGameTags(tags, game);
  updateDownloadButton(game);
  syncGameBackLabel();
  syncGameCollectionButton();
  renderMediaStrip(media, game.artwork?.gallery ?? []);
  renderGameRecommendations(recommendations, game);

  const coverSrc = coverUrl(game);
  const bgSrc = gameBackgroundUrl(game);
  cover.alt = `${game.name} cover art`;
  bg.src = bgSrc;
  const coverFallback = "https://placehold.co/300x420/202020/ffffff.png?text=No+Cover";
  bindCroppedCover(cover, coverSrc, {
    fallbackSrc: coverFallback,
    onReady: () => {
      if (activeGame?.title_id !== game.title_id) return;
      cover.classList.add("is-loaded");
    },
    onError: () => {
      coverWrap.classList.remove("is-loading");
      coverWrap.classList.add("is-loaded");
      cover.classList.add("is-loaded");
    }
  });

  let gamePageRevealed = false;
  const revealGamePage = (): void => {
    if (gamePageRevealed || activeGame?.title_id !== game.title_id) return;
    gamePageRevealed = true;
    page.classList.remove("game-page--loading");
    page.classList.add("game-page--ready");
  };

  const revealFallbackTimer = window.setTimeout(revealGamePage, 3500);

  void Promise.all([preloadCroppedCover(coverSrc), preloadImage(bgSrc)]).then(() => {
    if (activeGame?.title_id !== game.title_id) return;
    coverWrap.classList.remove("is-loading");
    coverWrap.classList.add("is-loaded");
    cover.classList.add("is-loaded");
    bg.classList.add("is-loaded");
    window.clearTimeout(revealFallbackTimer);
    requestAnimationFrame(() => requestAnimationFrame(revealGamePage));
  });

  if (push) {
    syncGameToUrl(game.title_id, true);
  }
  syncGameHead(game);
}

function upsertMeta(name: string, content: string, attribute: "name" | "property" = "name"): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setCanonical(pathAndQuery: string): void {
  const canonicalHref = new URL(pathAndQuery, window.location.origin).toString();
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", canonicalHref);
}

function syncRobotsHead(): void {
  applyRobotsMeta();
}

function syncDefaultHead(): void {
  document.title = DEFAULT_TITLE;
  upsertMeta("description", DEFAULT_DESCRIPTION);
  upsertMeta("og:title", DEFAULT_TITLE, "property");
  upsertMeta("og:description", DEFAULT_DESCRIPTION, "property");
  upsertMeta("og:url", new URL(window.location.pathname, window.location.origin).toString(), "property");
  upsertMeta("og:image", DEFAULT_OG_IMAGE, "property");
  upsertMeta("twitter:title", DEFAULT_TITLE);
  upsertMeta("twitter:description", DEFAULT_DESCRIPTION);
  upsertMeta("twitter:card", "summary_large_image");
  upsertMeta("twitter:image", DEFAULT_OG_IMAGE);
  syncRobotsHead();
  setCanonical(window.location.pathname + window.location.search);
}

function syncGameHead(game: TitleEntry): void {
  const title = `${game.name} Xbox 360 ROM Download | ${SITE_NAME}`;
  const description =
    game.description?.trim() ||
    `Download ${game.name} for Xbox 360 — ROM, ISO, and XEX files with metadata, ratings, and cover art. Available on ${SITE_NAME}.`;
  const pageUrl = new URL(gamePagePath(game.title_id), window.location.origin).toString();
  const image = coverUrl(game);
  document.title = title;
  upsertMeta("description", description);
  upsertMeta("og:title", title, "property");
  upsertMeta("og:description", description, "property");
  upsertMeta("og:url", pageUrl, "property");
  upsertMeta("og:image", image, "property");
  upsertMeta("twitter:title", title);
  upsertMeta("twitter:description", description);
  upsertMeta("twitter:card", "summary_large_image");
  upsertMeta("twitter:image", image);
  upsertMeta("robots", "index, follow, max-image-preview:large");
  setCanonical(gamePagePath(game.title_id));
}

function similarTitles(game: TitleEntry, limit = 10): TitleEntry[] {
  const srcGenres = new Set((game.genre ?? []).map((g) => g.toLowerCase()));
  return db
    .filter((entry) => entry.title_id !== game.title_id)
    .map((entry) => {
      let score = 0;
      if (game.developer && entry.developer && game.developer.toLowerCase() === entry.developer.toLowerCase()) score += 4;
      if (game.publisher && entry.publisher && game.publisher.toLowerCase() === entry.publisher.toLowerCase()) score += 3;
      if (srcGenres.size && entry.genre?.length) {
        const overlap = entry.genre.filter((g) => srcGenres.has(g.toLowerCase())).length;
        score += overlap * 2;
      }
      const ratingGap = Math.abs((game.rating ?? 0) - (entry.rating ?? 0));
      score += Math.max(0, 1 - ratingGap / 5);
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.rating ?? 0) - (a.entry.rating ?? 0))
    .slice(0, limit)
    .map((row) => row.entry);
}

function closeSettings(): void {
  document.getElementById("setMod")?.classList.remove("show");
}

function isGameEntry(entry: TitleEntry): boolean {
  return (
    entry.downloads.length === 0 ||
    entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM")
  );
}

function isAddonEntry(entry: TitleEntry): boolean {
  return entry.downloads.some((d) => d.type === "DLC" || d.type === "Update");
}

function syncRegion(value: string): void {
  settings.r = value || "all";
  window.localStorage.setItem("x_r", settings.r);
  setDropdownValue("browseReg", settings.r);
  setDropdownValue("reg", settings.r);
  renderHeroRows();
  applyFilters();
}

function dlcPivotCount(): number {
  return db.filter((g) => {
    if (/demo|beta|trial/i.test(g.name)) return false;
    return g.downloads.some((d) => d.type === "DLC" || d.type === "Update");
  }).length;
}

function updateDlcPivotChrome(): void {
  const pivot = document.getElementById("p-DLC");
  const available = dlcPivotCount() > 0;
  pivot?.classList.toggle("hidden", !available);
  if (!available && category === "DLC") switchCategory("Game");
}

function updateBrowseModeChrome(): void {
  const isDlc = category === "DLC";
  const isCollections = category === "Collections";
  document.body.classList.toggle("browse-mode-dlc", isDlc);
  document.body.classList.toggle("browse-mode-collections", isCollections);

  const eyebrow = document.getElementById("siteHeroEyebrow");
  const title = document.getElementById("siteHeroTitle");
  const lead = document.getElementById("siteHeroLead");
  const gamesStat = document.getElementById("siteHeroGames");
  const addonsStat = document.getElementById("siteHeroAddons");
  const featuredTitle = document.getElementById("featuredTitle");
  const featuredSubtitle = document.getElementById("featuredSubtitle");

  if (eyebrow) {
    eyebrow.textContent = isCollections ? "Community" : isDlc ? "Add-ons & Updates" : "Xbox 360 Archive";
  }
  if (title) {
    title.innerHTML = isCollections
      ? 'Curated <span>collections</span> from players'
      : isDlc
        ? 'Download <span>DLC</span> and update packages'
        : 'Games, <span>DLC</span>, and metadata in one catalog';
  }
  if (lead) {
    lead.textContent = isCollections
      ? "Browse public game lists shared by xbx.place users — favorites, backlogs, themed sets, and more."
      : isDlc
        ? "Browse titles with downloadable add-on packs and title updates — open a tile to view and download files."
        : "Search thousands of titles with cover art, ratings, and downloadable archives — built for preservation and easy rediscovery.";
  }
  if (gamesStat) gamesStat.classList.toggle("site-hero-stat--muted", isDlc || isCollections);
  if (addonsStat) addonsStat.classList.toggle("site-hero-stat--emphasis", isDlc);
  if (featuredTitle) featuredTitle.textContent = isDlc ? "Has Add-ons" : "Top Rated";
  if (featuredSubtitle) {
    featuredSubtitle.textContent = isDlc ? "Titles with downloadable packages" : "Ranked by community score";
  }
  const filterTitle = document.getElementById("browseFilterDrawerTitle");
  const sortLabel = document.getElementById("browseSortLabel");
  const regionLabel = document.getElementById("browseRegionLabel");
  if (filterTitle) filterTitle.textContent = isDlc ? "Package filters" : "Catalog filters";
  if (sortLabel) sortLabel.textContent = isDlc ? "Sort by" : "Sort catalog";
  if (regionLabel) regionLabel.textContent = isDlc ? "File region" : "Region";
}

function regionLabel(value: string): string {
  return REGION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function closeFilterDrawer(): void {
  const drawer = document.getElementById("browseFilterDrawer");
  const toggle = document.getElementById("browseFilterToggle");
  drawer?.classList.add("hidden");
  toggle?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
}

function openFilterDrawer(): void {
  const drawer = document.getElementById("browseFilterDrawer");
  const toggle = document.getElementById("browseFilterToggle");
  drawer?.classList.remove("hidden");
  toggle?.classList.add("is-open");
  toggle?.setAttribute("aria-expanded", "true");
}

function toggleFilterDrawer(): void {
  const drawer = document.getElementById("browseFilterDrawer");
  if (drawer?.classList.contains("hidden")) openFilterDrawer();
  else closeFilterDrawer();
}

function defaultSortForCategory(): string {
  return category === "DLC" ? "name" : "rating";
}

function syncSortDropdownForCategory(): void {
  const options = category === "DLC" ? ADDON_SORT_OPTIONS : SORT_OPTIONS;
  const current = getDropdownValue("sort");
  const valid = options.some((option) => option.value === current);
  const value = valid ? current : defaultSortForCategory();
  replaceDropdownOptions("sort", options, value, onSortChange);
}

function onSortChange(): void {
  applyFilters();
  updateFilterDrawerChrome();
}

function updateFilterDrawerChrome(): void {
  const label = document.getElementById("browseFilterLabel");
  const toggle = document.getElementById("browseFilterToggle");
  const sort = getDropdownValue("sort") || defaultSortForCategory();
  const activeCount =
    (sort !== defaultSortForCategory() ? 1 : 0) +
    (settings.r !== "all" ? 1 : 0) +
    (activeGenre && category === "Game" ? 1 : 0) +
    (activeAddonType !== "all" && category === "DLC" ? 1 : 0);
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
  const chipCount = activeCount + (query ? 1 : 0);

  if (label) label.textContent = activeCount > 0 ? `Filters · ${activeCount}` : "Filters";
  toggle?.classList.toggle("is-active", chipCount > 0);
}

function bindFilterDrawer(): void {
  const drawer = document.getElementById("browseFilterDrawer");
  if (!drawer) return;

  document.getElementById("browseFilterToggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFilterDrawer();
  });
  document.getElementById("browseFilterClose")?.addEventListener("click", () => closeFilterDrawer());
  document.getElementById("browseFilterReset")?.addEventListener("click", () => {
    setDropdownValue("sort", defaultSortForCategory());
    syncRegion("all");
    if (category === "DLC") setAddonTypeFilter("all", { scroll: false });
    applyFilters();
    closeFilterDrawer();
  });
  drawer.addEventListener("click", (event) => event.stopPropagation());

  if (drawer.dataset.bound !== "true") {
    drawer.dataset.bound = "true";
    document.addEventListener("click", () => closeFilterDrawer());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeFilterDrawer();
    });
  }
}

function renderEmptyCatalog(): void {
  const grid = document.getElementById("grid");
  if (!grid) return;

  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
  const chips: string[] = [];
  if (activeAddonType !== "all" && category === "DLC") {
    chips.push(
      `<button type="button" class="browse-empty-chip" data-clear-addon-type>${escapeHtml(addonTypeLabel(activeAddonType))}</button>`
    );
  }
  if (activeGenre && category === "Game") {
    chips.push(`<button type="button" class="browse-empty-chip" data-clear-genre>${escapeHtml(genreLabel(activeGenre))}</button>`);
  }
  if (settings.r !== "all") {
    chips.push(`<button type="button" class="browse-empty-chip" data-clear-region>${escapeHtml(regionLabel(settings.r))}</button>`);
  }
  if (query) {
    chips.push(`<span class="browse-empty-chip browse-empty-chip--static">Search: ${escapeHtml(query)}</span>`);
  }

  grid.innerHTML = `
    <div class="browse-empty" role="status">
      <i class="fa-solid fa-magnifying-glass browse-empty-icon" aria-hidden="true"></i>
      <h3 class="browse-empty-title">No titles match</h3>
      <p class="browse-empty-lead">Try adjusting your filters or clearing the search query.</p>
      ${chips.length ? `<div class="browse-empty-chips">${chips.join("")}</div>` : ""}
      <button type="button" class="btn browse-empty-clear" data-clear-all>Clear all filters</button>
    </div>
  `;

  grid.querySelector("[data-clear-addon-type]")?.addEventListener("click", () => setAddonTypeFilter("all", { scroll: false }));
  grid.querySelector("[data-clear-genre]")?.addEventListener("click", () => setGenreFilter(null, { scroll: false }));
  grid.querySelector("[data-clear-region]")?.addEventListener("click", () => syncRegion("all"));
  grid.querySelector("[data-clear-all]")?.addEventListener("click", () => {
    activeGenre = null;
    activeAddonType = "all";
    syncGenreToUrl(null, true);
    syncAddonTypeToUrl("all", true);
    const input = document.getElementById("q") as HTMLInputElement | null;
    if (input) input.value = "";
    syncSearchClearButton();
    syncRegion("all");
    setDropdownValue("sort", defaultSortForCategory());
    renderGenreRail();
    renderAddonTypeRail();
  });
}

function siteHeroCandidates(): TitleEntry[] {
  const pool = db.filter((g) => (g.rating ?? 0) >= 4 && !/demo|beta/i.test(g.name));
  return pool.length >= 4 ? pool : db.filter((g) => !/demo|beta/i.test(g.name));
}

function renderSiteHero(): void {
  const slides = document.getElementById("siteHeroSlides");
  const covers = document.getElementById("siteHeroCovers");
  const gamesEl = document.getElementById("siteHeroGames");
  const addonsEl = document.getElementById("siteHeroAddons");
  if (!slides || !covers) return;

  const gameCount = db.filter((g) => isGameEntry(g) && !/demo|beta|trial/i.test(g.name)).length;
  const addonCount = db.filter((g) => isAddonEntry(g) && !/demo|beta|trial/i.test(g.name)).length;
  if (gamesEl) gamesEl.innerHTML = `<strong>${gameCount.toLocaleString()}</strong> games`;
  if (addonsEl) {
    addonsEl.hidden = addonCount === 0;
    if (addonCount > 0) addonsEl.innerHTML = `<strong>${addonCount.toLocaleString()}</strong> add-ons`;
  }
  updateSearchPlaceholder();

  const pool = siteHeroCandidates();
  const { covers: coverPicks, backgrounds: bgPicks } = pickHeroVisualTitles(db, pool);
  updateDlcPivotChrome();

  slides.innerHTML = bgPicks
    .map(
      (entry, index) =>
        `<div class="site-hero-slide" style="--slide-index:${index};background-image:url('${bgUrl(entry)}')"></div>`
    )
    .join("");

  covers.innerHTML = "";
  coverPicks.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = "site-hero-cover cover-crop-view";
    card.style.setProperty("--cover-index", String(index));
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    bindCroppedCover(img, coverUrl(entry));
    card.appendChild(img);
    covers.appendChild(card);
  });
}

function bindSiteHeroEvents(): void {
  document.getElementById("siteHeroBrowse")?.addEventListener("click", (event) => {
    event.preventDefault();
    scrollBelowHeader(document.getElementById("catalogSection"));
  });
}

function syncSearchClearButton(): void {
  const input = document.getElementById("q") as HTMLInputElement | null;
  const clearBtn = document.getElementById("search-clear");
  const field = document.querySelector<HTMLElement>(".nav-search-field");
  if (!input || !clearBtn) return;
  const hasQuery = input.value.trim().length > 0;
  clearBtn.classList.toggle("hidden", !hasQuery);
  clearBtn.toggleAttribute("disabled", !hasQuery);
  field?.classList.toggle("has-query", hasQuery);
}

function clearSearchQuery(): void {
  const input = document.getElementById("q") as HTMLInputElement | null;
  if (!input) return;
  input.value = "";
  syncSearchClearButton();
  syncSearchToUrl("", true);
  syncRobotsHead();
  applyFilters();
  input.focus();
}

function updateSearchPlaceholder(): void {
  const input = document.getElementById("q") as HTMLInputElement | null;
  if (!input) return;
  if (category === "Collections") {
    input.placeholder = "Search collections or gamertags…";
    input.setAttribute("aria-label", "Search public collections or gamertags");
    return;
  }
  const gameCount = db.filter((g) => isGameEntry(g) && !/demo|beta|trial/i.test(g.name)).length;
  const addonCount = db.filter((g) => isAddonEntry(g) && !/demo|beta|trial/i.test(g.name)).length;
  if (category === "DLC") {
    input.placeholder = `Search ${addonCount.toLocaleString()} games or pack filenames…`;
    input.setAttribute("aria-label", `Search games or downloadable package filenames`);
    return;
  }
  const total = gameCount + addonCount;
  input.placeholder = `Search ${total.toLocaleString()} games, DLCs, or publishers…`;
  input.setAttribute("aria-label", `Search ${total.toLocaleString()} games, DLCs, or publishers`);
}

function featuredCandidates(): TitleEntry[] {
  if (category === "Collections") return [];
  const regionMatch = (g: TitleEntry) =>
    settings.r === "all" || (g.regions ?? []).includes(settings.r) || (g.regions ?? []).includes("World");

  if (category === "DLC") {
    return db.filter(
      (g) =>
        !/demo|beta/i.test(g.name) &&
        regionMatch(g) &&
        g.downloads.some((d) => d.type === "DLC" || d.type === "Update")
    );
  }

  let candidates = db.filter(
    (g) => (g.rating ?? 0) >= 4.5 && !/demo|beta/i.test(g.name) && regionMatch(g)
  );
  if (candidates.length < 3) {
    candidates = db.filter((g) => (g.rating ?? 0) >= 4.0 && !/demo|beta/i.test(g.name) && regionMatch(g));
  }
  return candidates;
}

function renderHeroRows(): void {
  const hGrid = document.getElementById("hGrid");
  if (!hGrid) return;
  if (category === "Collections") {
    hGrid.innerHTML = "";
    return;
  }

  const candidates = featuredCandidates();
  const top = candidates.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 3);
  hGrid.innerHTML = "";

  if (!top.length) {
    hGrid.innerHTML = `<p class="browse-featured-empty">No featured titles for the current filters.</p>`;
    return;
  }

  for (const [index, game] of top.entries()) {
    const rank = index + 1;
    const card = createHeroCard(game, {
      rank,
      eyebrow: category === "DLC" ? "Has Add-ons" : `#${rank} Top Rated`,
      backgroundUrl: gameBackgroundUrl(game),
      onActivate: (entry) => {
        if (category === "DLC") openPackageModal(entry);
        else openGamePage(entry);
      }
    });
    hGrid.appendChild(card);
  }
  observeRevealChildren(hGrid, ".browse-hero-card", 45);
}

function buildGridCard(game: TitleEntry): HTMLAnchorElement {
  const onActivate = (_node: HTMLAnchorElement, entry: TitleEntry) => {
    if (category === "DLC") openPackageModal(entry);
    else openGamePage(entry);
  };

  if (category === "DLC") {
    return createAddonListCard(game, {
      subtitle: addonPackageSummary(game, activeAddonType),
      coverSrc: coverUrl(game),
      dimmed: !game.downloads?.length,
      onActivate
    });
  }

  let badge = "";
  if (game.downloads.some((d) => d.type === "DLC")) badge = "+ Addons";

  const card = createGridCard(game, {
    badge,
    dimmed: !game.downloads?.length,
    onActivate
  });
  card.dataset.titleId = game.title_id;
  return card;
}

function renderScrollStatus(): void {
  const pager = document.getElementById("pager");
  if (!pager) return;
  if (!filtered.length) {
    pager.innerHTML = "";
    return;
  }
  pager.innerHTML = `<span class="page-meta">Showing ${loadedCount.toLocaleString()} of ${filtered.length.toLocaleString()}</span>`;
}

function setupGridObserver(): void {
  gridObserver?.disconnect();
  const sentinel = document.getElementById("gridSentinel");
  if (!sentinel || loadedCount >= filtered.length) return;

  gridObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreTiles();
    },
    { rootMargin: "0px 0px 400px 0px" }
  );
  gridObserver.observe(sentinel);
}

function appendCatalogTiles(): void {
  const grid = document.getElementById("grid");
  if (!grid || !filtered.length) return;

  const start = loadedCount;
  const end = Math.min(filtered.length, start + batchSize(grid));
  const slice = filtered.slice(start, end);
  if (!slice.length) {
    renderScrollStatus();
    setupGridObserver();
    return;
  }

  const frag = document.createDocumentFragment();
  const cardSelector = catalogCardSelector();
  const prevCount = grid.querySelectorAll(cardSelector).length;
  for (const game of slice) {
    frag.appendChild(buildGridCard(game));
  }
  grid.appendChild(frag);
  loadedCount = end;

  const cols = category === "DLC" ? 1 : getGridColumnCount(grid);
  const eagerImages = category === "DLC" ? 6 : cols;
  grid.querySelectorAll<HTMLImageElement>(`${cardSelector} img`).forEach((img, index) => {
    if (index < eagerImages && prevCount === 0) img.fetchPriority = "high";
  });
  if (prevCount === 0) {
    observeRevealFirstRow(grid, cardSelector, cols, 35);
  } else {
    grid.querySelectorAll<HTMLElement>(cardSelector).forEach((card, index) => {
      if (index >= prevCount) observeReveal(card, (index - prevCount) * 35);
    });
  }

  renderScrollStatus();
  setupGridObserver();
}

function loadMoreTiles(): void {
  if (isLoadingMore || loadedCount >= filtered.length) return;
  isLoadingMore = true;
  appendCatalogTiles();
  isLoadingMore = false;
}

let gridTransitionTimer = 0;

function resetCatalogGrid(): void {
  const grid = document.getElementById("grid");
  if (!grid) return;

  grid.classList.add("is-transitioning");
  window.clearTimeout(gridTransitionTimer);

  gridTransitionTimer = window.setTimeout(() => {
    gridObserver?.disconnect();
    loadedCount = 0;
    isLoadingMore = false;
    syncCatalogGridLayout();
    grid.innerHTML = "";
    if (!filtered.length) {
      renderEmptyCatalog();
      renderScrollStatus();
    } else {
      appendCatalogTiles();
    }
    
    void grid.offsetWidth;
    grid.classList.remove("is-transitioning");
  }, 150);
}

function updateBrowseSectionChrome(): void {
  document.querySelectorAll<HTMLElement>(".games-only").forEach((node) => {
    node.classList.toggle("hidden", category !== "Game");
  });
  document.querySelectorAll<HTMLElement>(".dlc-only").forEach((node) => {
    node.classList.toggle("hidden", category !== "DLC");
  });
  document.querySelectorAll<HTMLElement>(".catalog-only").forEach((node) => {
    node.classList.toggle("hidden", category === "Collections");
  });
  document.querySelectorAll<HTMLElement>(".collections-only").forEach((node) => {
    node.classList.toggle("hidden", category !== "Collections");
  });
  document.getElementById("browseFilterToggle")?.classList.toggle("hidden", category === "Collections");
}

function updateGenreRailOverflow(): void {
  const scroll = document.getElementById("genreRailScroll");
  const rail = document.getElementById("genreRail");
  if (!scroll || !rail) return;
  scroll.classList.toggle("is-overflowing", rail.scrollWidth > scroll.clientWidth);
}

function updateAddonTypeRailOverflow(): void {
  const scroll = document.getElementById("addonTypeRailScroll");
  const rail = document.getElementById("addonTypeRail");
  if (!scroll || !rail) return;
  scroll.classList.toggle("is-overflowing", rail.scrollWidth > scroll.clientWidth);
}

function renderAddonTypeRail(): void {
  const rail = document.getElementById("addonTypeRail");
  if (!rail) return;
  rail.innerHTML = ADDON_TYPE_FILTERS.map(
    (filter) => `
      <button
        type="button"
        class="genre-chip${activeAddonType === filter.slug ? " is-active" : ""}"
        data-addon-type="${filter.slug}"
        role="option"
        aria-selected="${activeAddonType === filter.slug ? "true" : "false"}"
      >
        <i class="fa-solid ${filter.icon}" aria-hidden="true"></i>
        <span>${filter.label}</span>
      </button>
    `
  ).join("");
  requestAnimationFrame(() => updateAddonTypeRailOverflow());
}

function catalogSectionTitle(): string {
  if (category === "Game") {
    return activeGenre ? genreLabel(activeGenre) : "All Games";
  }
  if (activeAddonType === "dlc") return "DLC & Add-ons";
  if (activeAddonType === "update") return "Title Updates";
  return "All Packages";
}

function renderGenreRail(): void {
  const rail = document.getElementById("genreRail");
  if (!rail) return;
  rail.innerHTML = GENRE_FILTERS.map(
    (filter) => `
      <button
        type="button"
        class="genre-chip${activeGenre === filter.slug ? " is-active" : ""}"
        data-genre="${filter.slug}"
        role="option"
        aria-selected="${activeGenre === filter.slug ? "true" : "false"}"
      >
        <i class="fa-solid ${filter.icon}" aria-hidden="true"></i>
        <span>${filter.label}</span>
      </button>
    `
  ).join("");
  requestAnimationFrame(() => updateGenreRailOverflow());
}

function renderActiveFilters(): void {
  const bar = document.getElementById("browseFilterBar");
  if (!bar) return;
  const chips: string[] = [];
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";

  if (activeAddonType !== "all" && category === "DLC") {
    chips.push(
      `<span class="browse-filter-chip">${addonTypeLabel(activeAddonType)}<button type="button" data-clear-addon-type aria-label="Clear package type filter"><i class="fa-solid fa-xmark"></i></button></span>`
    );
  }
  if (activeGenre && category === "Game") {
    chips.push(
      `<span class="browse-filter-chip">${genreLabel(activeGenre)}<button type="button" data-clear-genre aria-label="Clear genre filter"><i class="fa-solid fa-xmark"></i></button></span>`
    );
  }
  if (settings.r !== "all") {
    chips.push(
      `<span class="browse-filter-chip">${escapeHtml(regionLabel(settings.r))}<button type="button" data-clear-region aria-label="Clear region filter"><i class="fa-solid fa-xmark"></i></button></span>`
    );
  }
  if (query) {
    chips.push(`<span class="browse-filter-chip">Search: ${escapeHtml(query)}</span>`);
  }

  if (!chips.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    updateFilterDrawerChrome();
    return;
  }

  bar.classList.remove("hidden");
  bar.innerHTML = `${chips.join("")}<button type="button" class="browse-filter-clear" data-clear-all>Clear all</button>`;
  updateFilterDrawerChrome();
}

function setGenreFilter(
  slug: string | null,
  options: { push?: boolean; scroll?: boolean } = {}
): void {
  activeGenre = slug;
  syncGenreToUrl(slug, options.push ?? true);
  renderGenreRail();
  renderActiveFilters();
  applyFilters();
  if (slug && options.scroll !== false) {
    scrollBelowHeader(document.getElementById("catalogSection"));
  }
}

function setAddonTypeFilter(
  slug: AddonTypeSlug,
  options: { push?: boolean; scroll?: boolean } = {}
): void {
  activeAddonType = slug;
  syncAddonTypeToUrl(slug, options.push ?? true);
  renderAddonTypeRail();
  renderActiveFilters();
  applyFilters();
  if (slug !== "all" && options.scroll !== false) {
    scrollBelowHeader(document.getElementById("catalogSection"));
  }
}

function bindGenreEvents(): void {
  document.getElementById("genreRail")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".genre-chip");
    if (!button?.dataset.genre) return;
    const slug = button.dataset.genre;
    setGenreFilter(activeGenre === slug ? null : slug);
  });
  document.getElementById("addonTypeRail")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".genre-chip");
    const slug = button?.dataset.addonType;
    if (!isAddonTypeSlug(slug)) return;
    setAddonTypeFilter(activeAddonType === slug ? "all" : slug);
  });
  document.getElementById("browseFilterBar")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-clear-addon-type]")) {
      setAddonTypeFilter("all", { scroll: false });
      return;
    }
    if (target.closest("[data-clear-genre]")) {
      setGenreFilter(null, { scroll: false });
      return;
    }
    if (target.closest("[data-clear-region]")) {
      syncRegion("all");
      return;
    }
    if (target.closest("[data-clear-all]")) {
      activeGenre = null;
      activeAddonType = "all";
      syncGenreToUrl(null, true);
      syncAddonTypeToUrl("all", true);
      const input = document.getElementById("q") as HTMLInputElement | null;
      if (input) input.value = "";
      syncSearchToUrl("", true);
      syncRobotsHead();
      syncSearchClearButton();
      syncRegion("all");
      setDropdownValue("sort", defaultSortForCategory());
      renderGenreRail();
      renderAddonTypeRail();
      renderActiveFilters();
      applyFilters();
    }
  });
}

function titleIndexMap(): Map<string, TitleEntry> {
  return new Map(db.map((row) => [row.title_id, row]));
}

function filteredDiscoverCollections(): DiscoverCollection[] {
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim().toLowerCase() ?? "";
  if (!query) return discoverCollections;
  return discoverCollections.filter((collection) => {
    const haystack = `${collection.name} ${collection.owner_gamertag} ${collection.description ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderDiscoverCollectionsView(): void {
  const index = titleIndexMap();
  setCollectionDetailTitleIndex(index);
  renderCollectionsDiscoverGrid(filteredDiscoverCollections(), index, {
    onOpenCollection: (collectionId) => {
      void openCollectionDetail(collectionId, true);
    },
    onOpenProfile: (gamertag) => {
      void openPublicProfileByGamertag(gamertag, true);
    }
  });
}

async function refreshDiscoverCollections(force = false): Promise<void> {
  if (discoverCollectionsLoading) return;
  if (discoverCollectionsLoaded && !force) {
    renderDiscoverCollectionsView();
    return;
  }

  discoverCollectionsLoading = true;
  setCollectionsDiscoverError(null);
  setCollectionsDiscoverLoading(true);
  try {
    discoverCollections = await loadDiscoverPublicCollections();
    discoverCollectionsLoaded = true;
    renderDiscoverCollectionsView();
  } catch (error) {
    discoverCollections = [];
    discoverCollectionsLoaded = true;
    setCollectionsDiscoverError(
      error instanceof Error ? error.message : "Could not load public collections."
    );
    renderDiscoverCollectionsView();
  } finally {
    discoverCollectionsLoading = false;
    setCollectionsDiscoverLoading(false);
  }
}

function applyCollectionsFilters(): void {
  updateSearchPlaceholder();
  syncSearchClearButton();
  renderDiscoverCollectionsView();
  updateBrowseSectionChrome();
}

function applyFilters(): void {
  updateSearchPlaceholder();
  syncSearchClearButton();
  if (category === "Collections") {
    applyCollectionsFilters();
    return;
  }

  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.toLowerCase() ?? "";
  closePackageModal();

  const sort = getDropdownValue("sort") || defaultSortForCategory();
  const cnt = document.getElementById("cnt");
  const title = document.getElementById("lTitle");
  if (title) title.textContent = catalogSectionTitle();

  filtered = db.filter((g) => {
    if (/demo|beta|trial/i.test(g.name)) return false;
    const nameMatch = g.name.toLowerCase().includes(query);
    const packageMatch = g.downloads.some(
      (d) =>
        matchesAddonTypeFilter(d, activeAddonType) &&
        ((d.label ?? d.filename).toLowerCase().includes(query) || d.filename.toLowerCase().includes(query))
    );
    const match = category === "DLC" ? nameMatch || packageMatch : nameMatch;
    const catMatch =
      category === "Game"
        ? g.downloads.length === 0 || g.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM")
        : titleHasAddonType(g, activeAddonType);
    const regMatch =
      settings.r === "all" || (g.regions ? g.regions.includes(settings.r) || g.regions.includes("World") : false);
    const genreMatch = category === "Game" && matchesGenreFilter(g, activeGenre);
    return category === "DLC" ? match && catMatch && regMatch : match && catMatch && regMatch && genreMatch;
  });

  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "packs") return countAddonDownloads(b, activeAddonType) - countAddonDownloads(a, activeAddonType);
    if (sort === "newest") return (Date.parse(b.release_date ?? "") || 0) - (Date.parse(a.release_date ?? "") || 0);
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  if (cnt) {
    cnt.textContent =
      category === "DLC"
        ? `${filtered.length.toLocaleString()} titles with packages`
        : `${filtered.length.toLocaleString()} titles`;
  }
  resetCatalogGrid();
  renderActiveFilters();
  updateBrowseSectionChrome();
}

function switchCategory(next: Category): void {
  closePackageModal();
  if (document.body.classList.contains("profile-view")) {
    closeProfilePage();
  }
  if (document.body.classList.contains("game-view")) {
    closeGamePage();
  }
  if (document.body.classList.contains("collection-view")) {
    closeCollectionDetail(false);
  }
  if (next === "DLC" && activeGenre) {
    activeGenre = null;
    syncGenreToUrl(null, false);
  }
  if (next === "Game" && activeAddonType !== "all") {
    activeAddonType = "all";
    syncAddonTypeToUrl("all", false);
  }
  if (category === "Collections" && next !== "Collections") {
    closeCollectionDetail(false);
  }
  if (next !== "Collections" && category === "Collections") {
    closeFilterDrawer();
  }
  category = next;
  document.getElementById("p-Game")?.classList.toggle("active", next === "Game");
  document.getElementById("p-DLC")?.classList.toggle("active", next === "DLC");
  document.getElementById("p-Collections")?.classList.toggle("active", next === "Collections");
  updateBrowseModeChrome();
  syncSortDropdownForCategory();
  syncCatalogGridLayout();
  updateBrowseSectionChrome();
  renderHeroRows();
  renderGenreRail();
  renderAddonTypeRail();
  updateSearchPlaceholder();
  if (next === "Collections") {
    void refreshDiscoverCollections(true);
    applyCollectionsFilters();
  } else {
    applyFilters();
  }
  updateFilterDrawerChrome();
}

function setupSettings(): void {
  document.documentElement.style.setProperty("--green", settings.th);
  const picker = document.getElementById("thPick");
  if (!picker) return;
  picker.innerHTML = "";
  for (const color of THEME_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-label", `Use theme color ${color}`);
    if (color === settings.th) swatch.classList.add("active");
    swatch.addEventListener("click", () => {
      settings.th = color;
      document.documentElement.style.setProperty("--green", color);
      picker.querySelectorAll(".swatch").forEach((node) => node.classList.remove("active"));
      swatch.classList.add("active");
    });
    picker.appendChild(swatch);
  }
  setDropdownValue("reg", settings.r);
  setDropdownValue("browseReg", settings.r);
}

function saveSettings(): void {
  settings.r = getDropdownValue("reg") || "all";
  window.localStorage.setItem("x_th", settings.th);
  window.localStorage.setItem("x_r", settings.r);
  setDropdownValue("browseReg", settings.r);
  closeSettings();
  renderHeroRows();
  applyFilters();
}

function bindStaticEvents(): void {
  document.getElementById("btt")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.getElementById("close-settings")?.addEventListener("click", () => closeSettings());
  document.getElementById("save-settings")?.addEventListener("click", () => saveSettings());
  document.getElementById("close-package-mod")?.addEventListener("click", () => closePackageModal());
  document.getElementById("close-game-page")?.addEventListener("click", () => closeGamePage());
  document.getElementById("gp-download-btn")?.addEventListener("click", () => openDownloadModal());
  document.getElementById("close-download-mod")?.addEventListener("click", () => closeDownloadModal());
  document.getElementById("close-media-lightbox")?.addEventListener("click", () => closeMediaLightbox());
  document.getElementById("mediaLightbox")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMediaLightbox();
  });
  document.getElementById("media-lightbox-prev")?.addEventListener("click", () => {
    if (mediaLightboxImages.length <= 1) return;
    mediaLightboxIndex = (mediaLightboxIndex - 1 + mediaLightboxImages.length) % mediaLightboxImages.length;
    syncMediaLightbox();
  });
  document.getElementById("media-lightbox-next")?.addEventListener("click", () => {
    if (mediaLightboxImages.length <= 1) return;
    mediaLightboxIndex = (mediaLightboxIndex + 1) % mediaLightboxImages.length;
    syncMediaLightbox();
  });
  document.addEventListener("keydown", (event) => {
    const lightbox = document.getElementById("mediaLightbox");
    if (!lightbox?.classList.contains("show")) return;
    if (event.key === "Escape") closeMediaLightbox();
    if (event.key === "ArrowLeft") document.getElementById("media-lightbox-prev")?.click();
    if (event.key === "ArrowRight") document.getElementById("media-lightbox-next")?.click();
  });
  window.addEventListener("xbx-open-collection", (event) => {
    const collectionId = (event as CustomEvent<{ collectionId?: string }>).detail?.collectionId;
    if (collectionId) void openCollectionDetail(collectionId, true);
  });
  window.addEventListener("xbx-open-collections-tab", () => {
    if (category !== "Collections") switchCategory("Collections");
  });
  document.getElementById("p-Game")?.addEventListener("click", () => switchCategory("Game"));
  document.getElementById("p-DLC")?.addEventListener("click", () => switchCategory("DLC"));
  document.getElementById("p-Collections")?.addEventListener("click", () => switchCategory("Collections"));
  window.addEventListener("xbx-collections-changed", () => {
    discoverCollectionsLoaded = false;
    if (category === "Collections") {
      void refreshDiscoverCollections(true);
    }
  });
  bindSiteHeroEvents();
  bindGenreEvents();
  bindFilterDrawer();
  let searchTimer = 0;
  const searchInput = document.getElementById("q") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    syncSearchClearButton();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      syncSearchToUrl(searchInput.value, true);
      syncRobotsHead();
      applyFilters();
    }, 150);
  });
  document.getElementById("search-clear")?.addEventListener("click", () => clearSearchQuery());
  bindFormControlGlobals();
  mountDropdown("sort", onSortChange);
  mountDropdown("browseReg", () => syncRegion(getDropdownValue("browseReg")));
  mountDropdown("reg");
  initFormControls();
  document.getElementById("setMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("setMod")?.classList.contains("show")) closeSettings();
  });
  document.getElementById("downloadMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDownloadModal();
  });
  document.getElementById("packageMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePackageModal();
  });
  window.addEventListener("xbx-close-game", (event) => {
    const push = (event as CustomEvent<{ push?: boolean }>).detail?.push ?? false;
    closeGamePage(push);
  });
  window.addEventListener("xbx-close-collection", (event) => {
    const push = (event as CustomEvent<{ push?: boolean }>).detail?.push ?? true;
    closeCollectionDetail(push);
  });
  window.addEventListener("xbx-open-game", (event) => {
    const titleId = (event as CustomEvent<{ titleId?: string }>).detail?.titleId;
    if (!titleId) return;
    const found = db.find((g) => g.title_id === titleId);
    if (found) openGamePage(found);
  });
  window.addEventListener("scroll", () => {
    document.getElementById("btt")?.classList.toggle("show", window.scrollY > 500);
  });
  let gridLayoutTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(gridLayoutTimer);
    gridLayoutTimer = window.setTimeout(() => {
      const grid = document.getElementById("grid");
      if (!grid || !filtered.length) return;
      setupGridObserver();
      updateGenreRailOverflow();
      updateAddonTypeRailOverflow();
    }, 150);
  });
}

async function bootstrap(): Promise<void> {
  renderShell();
  initScrollLock();
  syncDefaultHead();
  setupSettings();
  renderSkeletonTiles();
  bindStaticEvents();
  bindAuthUi();
  bindCollectionUi();
  bindCollectionDetailUi();
  bindCommentsUi();
  bindCommentReportUi();
  bindGuestDownloadGateUi();
  bindDownloadCountdownUi();
  bindGameReportUi(() => activeGame);
  const [, rows] = await Promise.all([initAuth(), loadTitles(), loadGameSlugs(), initProxyPool()]);
  db = rows;
  renderSiteHero();
  updateBrowseModeChrome();
  renderHeroRows();
  activeGenre = readGenreFromUrl();
  activeAddonType = readAddonTypeFromUrl();
  if (window.location.search.includes("genre=") && activeGenre) {
    syncGenreToUrl(activeGenre, false);
  }
  const initialSearch = readSearchFromUrl();
  const searchInputEl = document.getElementById("q") as HTMLInputElement | null;
  if (searchInputEl && initialSearch) {
    searchInputEl.value = initialSearch;
    syncSearchClearButton();
  }
  renderGenreRail();
  renderAddonTypeRail();
  syncSortDropdownForCategory();
  updateBrowseSectionChrome();
  applyFilters();
  updateFilterDrawerChrome();

  const initialGameId = readGameIdFromUrl();
  const initialProfile = new URLSearchParams(window.location.search).get("profile");
  const initialCollection = new URLSearchParams(window.location.search).get("collection");
  if (initialCollection) {
    switchCategory("Collections");
    await syncCollectionRouteFromUrl();
  } else if (initialProfile) {
    await syncProfileRouteFromUrl();
  }
  if (initialGameId) {
    if (window.location.search.includes("title=")) {
      syncGameToUrl(initialGameId, false);
    }
    const found = db.find((g) => g.title_id.toUpperCase() === initialGameId.toUpperCase());
    if (found) openGamePage(found, false);
  }
  syncRobotsHead();
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const collectionId = params.get("collection");
    const titleId = readGameIdFromUrl();

    if (params.get("profile")) {
      syncRobotsHead();
      return;
    }

    if (titleId) {
      const found = db.find((g) => g.title_id.toUpperCase() === titleId.toUpperCase());
      if (found) openGamePage(found, false);
      else closeGamePage(false);
      if (collectionId) void openCollectionDetail(collectionId, false);
      else closeCollectionDetail(false);
      syncRobotsHead();
      return;
    }

    closeGamePage(false);
    if (collectionId) {
      void syncCollectionRouteFromUrl();
      syncRobotsHead();
      return;
    }
    closeCollectionDetail(false);
    activeGenre = readGenreFromUrl();
    activeAddonType = readAddonTypeFromUrl();
    const searchInputPop = document.getElementById("q") as HTMLInputElement | null;
    if (searchInputPop) {
      searchInputPop.value = readSearchFromUrl();
      syncSearchClearButton();
    }
    renderGenreRail();
    renderAddonTypeRail();
    syncSortDropdownForCategory();
    updateBrowseSectionChrome();
    applyFilters();
    syncDefaultHead();
  });
}

document.body.classList.add("app-mounted");

bootstrap().catch((error: unknown) => {
  if (root) {
    root.innerHTML = `<div class="app-error">Error loading DB: ${error instanceof Error ? error.message : "unknown"}</div>`;
  }
});
