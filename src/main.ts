import "@fortawesome/fontawesome-free/css/all.min.css";
import "./styles.css";
import { initAuth } from "./auth";
import { initScrollLock } from "./scroll-lock";
import {
  authModalMarkup,
  bindAuthUi,
  closeProfilePage,
  openAuthModal,
  syncHeaderAccountPlacement,
  syncProfileRouteFromUrl
} from "./auth-ui";
import { bindCollectionUi, closeCollectionModal, setActiveGameForCollections } from "./collections-ui";
import { bgUrl, coverUrl, loadTitles, syncGameModalBackground } from "./data";
import { formatDownloadDisplay } from "./download-label";
import { formatDownloadProgress, startDownload } from "./downloads";
import {
  bindFormControlGlobals,
  dropdownMarkup,
  getDropdownValue,
  initFormControls,
  mountDropdown,
  REGION_OPTIONS,
  setDropdownValue,
  SORT_OPTIONS
} from "./form-controls";
import { createGridCard, createHeroCard, stars } from "./browse-card";
import {
  GENRE_FILTERS,
  genreLabel,
  matchesGenreFilter,
  readGenreFromUrl,
  syncGenreToUrl
} from "./genres";
import { observeRevealChildren, observeRevealFirstRow } from "./reveal";
import type { DownloadEntry, TitleEntry } from "./types";

type Category = "Game" | "DLC";

type Settings = {
  th: string;
  r: string;
};

const THEME_COLORS = ["#107C10", "#0078D7", "#E81123", "#881798", "#FFB900"];
const SITE_NAME = "xbx.place";
const DEFAULT_TITLE = `${SITE_NAME} - Xbox 360 Games and DLC Archive`;
const DEFAULT_DESCRIPTION =
  "Browse Xbox 360 games, updates, and DLC in one fast catalog with title details, artwork, and downloadable archives.";
const BASE_URL = import.meta.env.BASE_URL;

const root = document.querySelector<HTMLDivElement>("#app");

let db: TitleEntry[] = [];
let filtered: TitleEntry[] = [];
let currentPage = 1;
let category: Category = "Game";
let activeGenre: string | null = null;
let activeTile: HTMLElement | null = null;
let shelfEl: HTMLElement | null = null;
let activeGame: TitleEntry | null = null;
const PAGE_SIZE = 50;
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

function pageStartIndices(total: number, cols: number): number[] {
  if (total <= 0) return [0];
  const starts = [0];
  let index = 0;
  const chunk = Math.max(cols, Math.floor(PAGE_SIZE / cols) * cols);
  while (total - index > PAGE_SIZE) {
    index += chunk;
    starts.push(index);
  }
  return starts;
}

function pageCountForGrid(grid: HTMLElement): number {
  return Math.max(1, pageStartIndices(filtered.length, getGridColumnCount(grid)).length);
}

function pageBounds(page: number, grid: HTMLElement): { start: number; end: number } {
  const starts = pageStartIndices(filtered.length, getGridColumnCount(grid));
  const index = Math.min(Math.max(1, page), starts.length) - 1;
  const start = starts[index] ?? 0;
  const end = index + 1 < starts.length ? (starts[index + 1] ?? filtered.length) : filtered.length;
  return { start, end };
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

function galleryImageUrl(url: string): string {
  if (url.startsWith("http://download.xbox.com/")) {
    return `https://${url.slice("http://".length)}`;
  }
  return url;
}

function handleDownload(sourceUrl: string, filename: string, button?: HTMLButtonElement): void {
  if (button) {
    button.disabled = true;
    button.classList.add("busy");
  }
  try {
    startDownload(sourceUrl, filename);
    showDownloadNotice(formatDownloadProgress({ loaded: 0, total: 0 }), false);
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("busy");
    }
  }
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
  return bgUrl(entry.title_id);
}

function iconUrl(entry: TitleEntry): string {
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${entry.title_id}/artwork/icon.png`;
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
  let html = "";
  for (let i = 0; i < 20; i += 1) {
    html += '<div class="browse-card is-loading skeleton"><div class="browse-card-ov"></div></div>';
  }
  grid.innerHTML = html;
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
        <div class="skel-line skel-line--title"></div>
        <div class="skel-line skel-line--short"></div>
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
  root.innerHTML = `
    <div id="dimmer"></div>
    <div id="btt"><i class="fa-solid fa-arrow-up"></i></div>
    <header class="header">
      <div class="top-bar">
        <div class="brand" id="brand-home" role="button" tabindex="0" aria-label="Back to browse">
          <img class="brand-logo" src="${BASE_URL}logo.png" width="36" height="36" alt="" />
          <h1>xbx.<span>place</span></h1>
        </div>
        <div class="header-account account-menu-host" id="header-account-fallback"></div>
      </div>
      <button class="profile-back-link" id="header-back-browse" type="button">
        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>Browse Games</span>
      </button>
      <div class="nav-row browse-only">
        <div class="pivots">
          <div class="pivot active" id="p-Game">GAMES</div>
          <div class="pivot" id="p-DLC">ADDONS & DLC</div>
        </div>
        <div class="nav-search-group">
          <div class="nav-search">
            <input id="q" class="inp" type="search" placeholder="Search..." aria-label="Search games" />
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
              <span class="site-hero-eyebrow" id="siteHeroEyebrow">Xbox 360 Archive</span>
              <h2 class="site-hero-title" id="siteHeroTitle">Games, <span>DLC</span>, and metadata in one catalog</h2>
              <p class="site-hero-lead" id="siteHeroLead">Search thousands of titles with cover art, ratings, and downloadable archives — built for preservation and easy rediscovery.</p>
              <div class="site-hero-stats">
                <span class="site-hero-stat" id="siteHeroGames"><strong>—</strong> games</span>
                <span class="site-hero-stat" id="siteHeroAddons"><strong>—</strong> add-ons</span>
              </div>
              <div class="site-hero-actions">
                <button class="btn site-hero-cta" id="siteHeroBrowse" type="button">
                  <i class="fa-solid fa-compact-disc" aria-hidden="true"></i><span>Browse catalog</span>
                </button>
                <button class="btn btn-ghost site-hero-ghost" id="siteHeroSearch" type="button">
                  <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Search titles</span>
                </button>
              </div>
            </div>
            <div class="site-hero-visual" aria-hidden="true">
              <div class="site-hero-covers" id="siteHeroCovers"></div>
            </div>
          </div>
        </section>
        <div class="browse-discovery">
        <section class="browse-section browse-section--featured browse-section--rail" id="featuredSection">
          <div class="browse-section-head">
            <h2 class="game-section-title" id="featuredTitle">Top Rated</h2>
          </div>
          <div class="browse-hero-grid" id="hGrid"></div>
        </section>
        <section class="browse-section browse-section--genres browse-section--rail games-only" id="genreSection">
          <div class="browse-section-head">
            <h2 class="game-section-title">Browse by Genre</h2>
            <span id="genreCount" class="browse-count"></span>
          </div>
          <div class="genre-grid" id="genreRail" role="listbox" aria-label="Browse by genre"></div>
        </section>
        </div>
        <section class="browse-section browse-section--catalog" id="catalogSection">
          <div class="browse-section-head">
            <h2 class="game-section-title" id="lTitle">All Games</h2>
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
                  <span>Filters</span>
                  <span class="browse-filter-badge hidden" id="browseFilterBadge" aria-hidden="true"></span>
                </button>
                <div class="browse-filter-drawer hidden" id="browseFilterDrawer" role="dialog" aria-label="Catalog filters">
                  <div class="browse-filter-drawer-head">
                    <h3 class="browse-filter-drawer-title">Catalog filters</h3>
                    <button type="button" class="browse-filter-drawer-close" id="browseFilterClose" aria-label="Close filters">
                      <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div class="browse-filter-drawer-body">
                    <div class="browse-filter-drawer-field">
                      <span class="browse-toolbar-label">Sort catalog</span>
                      ${dropdownMarkup("sort", SORT_OPTIONS, "rating", "ui-dropdown--block")}
                    </div>
                    <div class="browse-filter-drawer-field">
                      <span class="browse-toolbar-label">Region</span>
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
          <div id="pager" class="browse-pager"></div>
          <div id="dlcShelf" class="browse-shelf">
            <div class="browse-shelf-head">
              <div id="sTitle" class="browse-shelf-title"></div>
              <button id="close-shelf" class="browse-shelf-close" type="button" aria-label="Close addons shelf">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
            <div id="sGrid" class="browse-shelf-grid"></div>
          </div>
        </section>
      </div>
    </div>
    <div class="overlay" id="setMod">
      <div class="game-modal game-modal--ambient">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-settings" type="button" aria-label="Close preferences">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
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
    <div id="gamePage" class="game-page hidden" aria-hidden="true">
      <div class="game-page-bg" aria-hidden="true">
        <img id="gp-bg" class="game-page-bg-img" alt="" />
        <div class="game-page-bg-shade"></div>
      </div>
      <div class="game-page-shell">
        <button class="game-back-link" id="close-game-page" type="button">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
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
                      <span>Add to collection</span>
                    </button>
                    <button class="game-collection-save" id="gp-collection-save-btn" type="button" aria-label="Save to collection">
                      <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i>
                    </button>
                  </div>
                  <button class="game-details-btn" id="gp-details-btn" type="button" aria-label="More game options">
                    <i class="fa-solid fa-ellipsis" aria-hidden="true"></i>
                  </button>
                </div>
              </aside>
              <main class="game-page-main">
                <h1 id="gp-title" class="game-page-title game-reveal-block"></h1>
                <div class="game-page-rating game-reveal-block">
                  <div id="gp-rate"></div>
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
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay" id="downloadMod">
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
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Download</div>
            <h2 class="game-modal-title">Choose a file</h2>
            <p id="download-mod-subtitle" class="game-modal-sub"></p>
          </header>
          <section class="game-modal-section">
            <h3 class="game-section-title">Available files</h3>
            <div class="game-modal-panel">
              <div id="dl-l" class="game-modal-list"></div>
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay" id="collectionMod">
      <div class="game-modal">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-collection-mod" type="button" aria-label="Close collections">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span id="collection-mod-back-label">Back</span>
          </button>
          <div class="game-modal-body game-modal-body--wide collection-mod-shell">
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
            <div class="collection-mod-actions">
              <button class="btn btn-ghost collection-mod-new-btn" id="collection-mod-new-btn" type="button">
                <i class="fa-solid fa-folder-plus" aria-hidden="true"></i><span>Create New Collection</span>
              </button>
              <button class="btn collection-mod-save-btn" id="collection-mod-save-btn" type="button" disabled>
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
    ${authModalMarkup()}
    <footer class="footer">
      <div>
        <div class="footer-brand">
          <img class="footer-logo" src="${BASE_URL}logo.png" width="28" height="28" alt="" />
          <span class="footer-name">xbx.place</span>
        </div>
        <div>The premier archive for X360 content.</div>
      </div>
      <div class="footer-links">
        <a href="${aboutHref}">About</a><a href="${dmcaHref}">DMCA</a>
      </div>
    </footer>
  `;
}

function closeGamePage(push = true): void {
  closeDownloadModal();
  closeCollectionModal();
  activeGame = null;
  setActiveGameForCollections(null);
  document.body.classList.remove("game-view");
  syncHeaderAccountPlacement();
  const page = document.getElementById("gamePage");
  page?.classList.add("hidden");
  page?.classList.remove("game-page--loading", "game-page--ready");
  page?.setAttribute("aria-hidden", "true");
  if (push) {
    const next = activeGenre ? `${window.location.pathname}?genre=${encodeURIComponent(activeGenre)}` : window.location.pathname;
    window.history.pushState(null, "", next);
  }
  syncDefaultHead();
}

function closeDownloadModal(): void {
  document.getElementById("downloadMod")?.classList.remove("show");
}

function openDownloadModal(): void {
  if (!activeGame) return;
  const subtitle = document.getElementById("download-mod-subtitle");
  if (subtitle) subtitle.textContent = activeGame.name;
  syncGameModalBackground("downloadMod", activeGame);
  renderDownloadList(activeGame);
  document.getElementById("downloadMod")?.classList.add("show");
}

function renderDownloadList(game: TitleEntry): void {
  const dlList = document.getElementById("dl-l");
  if (!dlList) return;

  dlList.innerHTML = "";
  const downloads = game.downloads ?? [];
  if (!downloads.length) {
    dlList.innerHTML = '<div class="download-empty">No downloads available for this title.</div>';
    return;
  }

  for (const dl of downloads) {
    if (!dl.url) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dl-btn";
    const display = formatDownloadDisplay(dl.label ?? dl.filename);
    const meta = display.meta ? `<div class="dl-meta">${display.meta}</div>` : "";
    button.innerHTML = `<div><div class="dl-type">${(dl.type ?? "GAME").toUpperCase()}</div><b>${display.title}</b>${meta}</div><span><i class="fa-solid fa-download"></i></span>`;
    button.addEventListener("click", (event) => {
      handleDownload(dl.url, dl.filename, event.currentTarget as HTMLButtonElement);
    });
    dlList.appendChild(button);
  }
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
  platform.textContent = "Xbox 360";
  container.appendChild(platform);
  for (const genre of (game.genre ?? []).slice(0, 4)) {
    const tag = document.createElement("span");
    tag.className = "game-tag";
    tag.textContent = genre.toUpperCase();
    container.appendChild(tag);
  }
}

function bindHorizontalScroll(container: HTMLElement, selector: string): void {
  const wrap = container.querySelector<HTMLElement>(".game-scroll-wrap");
  const track = container.querySelector<HTMLElement>(selector);
  const prev = container.querySelector<HTMLButtonElement>(".game-scroll-prev");
  const next = container.querySelector<HTMLButtonElement>(".game-scroll-next");
  if (!wrap || !track || !next) return;

  const syncScrollFades = (): void => {
    const overflow = track.scrollWidth > track.clientWidth + 4;
    const atStart = track.scrollLeft <= 4;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    wrap.classList.toggle("has-overflow", overflow);
    wrap.classList.toggle("can-scroll-left", overflow && !atStart);
    wrap.classList.toggle("can-scroll-right", overflow && !atEnd);
  };

  const scrollStep = (): number => Math.max(280, track.clientWidth * 0.75);

  prev?.addEventListener("click", () => {
    track.scrollBy({ left: -scrollStep(), behavior: "smooth" });
  });
  next.addEventListener("click", () => {
    track.scrollBy({ left: scrollStep(), behavior: "smooth" });
  });
  track.addEventListener("scroll", syncScrollFades, { passive: true });
  window.addEventListener("resize", syncScrollFades);
  syncScrollFades();
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

  void preloadImage(galleryImageUrl(images[0] ?? "")).then(() => {
    scrollWrap.hidden = false;
    container.classList.remove("is-loading");
    container.classList.add("is-loaded");
  });

  images.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-media-card";
    const img = document.createElement("img");
    const proxied = galleryImageUrl(src);
    img.src = proxied;
    img.alt = `Screenshot ${index + 1}`;
    img.loading = "lazy";
    button.appendChild(img);
    button.addEventListener("click", () => window.open(proxied, "_blank", "noopener,noreferrer"));
    track.appendChild(button);
  });
  bindHorizontalScroll(container, ".game-media-scroll");
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

  void preloadImage(coverUrl(picks[0]!.title_id)).then(() => {
    scrollWrap.hidden = false;
    container.classList.remove("is-loading");
    container.classList.add("is-loaded");
  });

  for (const rec of picks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "game-rec-card";
    button.innerHTML = `
      <div class="game-rec-cover cover-crop-view">
        <img src="${coverUrl(rec.title_id)}" alt="" loading="lazy" />
      </div>
      <div class="game-rec-copy">
        <div class="game-rec-name"></div>
        <div class="game-rec-genre"></div>
      </div>
    `;
    button.querySelector(".game-rec-name")!.textContent = rec.name;
    button.querySelector(".game-rec-genre")!.textContent = (rec.genre?.slice(0, 2) ?? ["Related title"]).join(" · ");
    button.addEventListener("click", () => openGamePage(rec));
    track.appendChild(button);
  }
  bindHorizontalScroll(container, ".game-rec-scroll");
}

function openGamePage(game: TitleEntry, push = true): void {
  closeDownloadModal();
  closeCollectionModal();
  activeGame = game;
  setActiveGameForCollections(game);
  const title = document.getElementById("gp-title");
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
  if (!title || !desc || !dev || !pub || !reg || !release || !rate || !year || !cover || !coverWrap || !bg || !tags || !media || !recommendations || !page) return;

  page.classList.remove("hidden", "game-page--loading");
  page.classList.add("game-page--ready");
  document.body.classList.add("game-view");
  syncHeaderAccountPlacement();
  page.setAttribute("aria-hidden", "false");
  window.scrollTo({ top: 0, behavior: "auto" });

  coverWrap.classList.add("is-loading");
  coverWrap.classList.remove("is-loaded");
  cover.classList.remove("is-loaded");
  bg.classList.remove("is-loaded");

  title.textContent = game.name;
  desc.textContent = game.description ?? "No description available.";
  dev.textContent = game.developer ?? "—";
  pub.textContent = game.publisher ?? "—";
  reg.textContent = game.regions?.join(", ") || "—";
  release.textContent = game.release_date ?? "—";
  rate.innerHTML = stars(game.rating);
  year.textContent = game.release_date ? game.release_date.slice(0, 4) : "";

  renderGameTags(tags, game);
  updateDownloadButton(game);
  renderMediaStrip(media, game.artwork?.gallery ?? []);
  renderGameRecommendations(recommendations, game);

  const coverSrc = coverUrl(game.title_id);
  const bgSrc = gameBackgroundUrl(game);
  cover.src = coverSrc;
  cover.alt = `${game.name} cover art`;
  bg.src = bgSrc;
  cover.onerror = () => {
    cover.src = "https://placehold.co/300x420/202020/ffffff.png?text=No+Cover";
  };

  void Promise.all([preloadImage(coverSrc), preloadImage(bgSrc)]).then(() => {
    if (activeGame?.title_id !== game.title_id) return;
    coverWrap.classList.remove("is-loading");
    coverWrap.classList.add("is-loaded");
    cover.classList.add("is-loaded");
    bg.classList.add("is-loaded");
  });

  if (push) {
    window.history.pushState({ id: game.title_id }, "", `?title=${game.title_id}`);
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

function syncDefaultHead(): void {
  document.title = DEFAULT_TITLE;
  upsertMeta("description", DEFAULT_DESCRIPTION);
  upsertMeta("og:title", DEFAULT_TITLE, "property");
  upsertMeta("og:description", DEFAULT_DESCRIPTION, "property");
  upsertMeta("og:url", new URL(window.location.pathname, window.location.origin).toString(), "property");
  upsertMeta("twitter:title", DEFAULT_TITLE);
  upsertMeta("twitter:description", DEFAULT_DESCRIPTION);
  setCanonical(window.location.pathname);
}

function syncGameHead(game: TitleEntry): void {
  const title = `${game.name} | ${SITE_NAME}`;
  const description =
    game.description?.trim() ||
    `View ${game.name} on ${SITE_NAME} with metadata, rating, artwork, and downloadable archives where available.`;
  const pathAndQuery = `${window.location.pathname}?title=${encodeURIComponent(game.title_id)}`;
  const pageUrl = new URL(pathAndQuery, window.location.origin).toString();
  document.title = title;
  upsertMeta("description", description);
  upsertMeta("og:title", title, "property");
  upsertMeta("og:description", description, "property");
  upsertMeta("og:url", pageUrl, "property");
  upsertMeta("twitter:title", title);
  upsertMeta("twitter:description", description);
  setCanonical(pathAndQuery);
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

function openSettings(): void {
  document.getElementById("setMod")?.classList.add("show");
}

function closeSettings(): void {
  document.getElementById("setMod")?.classList.remove("show");
}

function isGameEntry(entry: TitleEntry): boolean {
  return (
    entry.downloads.length === 0 ||
    entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM" || d.type === "Mirror")
  );
}

function isAddonEntry(entry: TitleEntry): boolean {
  return entry.downloads.some((d) => d.type === "DLC" || d.type === "Update");
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function randomSample<T>(items: T[], count: number): T[] {
  return shuffleArray(items).slice(0, Math.min(count, items.length));
}

function syncRegion(value: string): void {
  settings.r = value || "all";
  window.localStorage.setItem("x_r", settings.r);
  setDropdownValue("browseReg", settings.r);
  setDropdownValue("reg", settings.r);
  renderHeroRows();
  applyFilters();
}

function updateBrowseModeChrome(): void {
  const isDlc = category === "DLC";
  document.body.classList.toggle("browse-mode-dlc", isDlc);

  const eyebrow = document.getElementById("siteHeroEyebrow");
  const title = document.getElementById("siteHeroTitle");
  const lead = document.getElementById("siteHeroLead");
  const gamesStat = document.getElementById("siteHeroGames");
  const addonsStat = document.getElementById("siteHeroAddons");
  const featuredTitle = document.getElementById("featuredTitle");

  if (eyebrow) eyebrow.textContent = isDlc ? "Add-ons & Updates" : "Xbox 360 Archive";
  if (title) {
    title.innerHTML = isDlc
      ? 'Download <span>DLC</span> and update packages'
      : 'Games, <span>DLC</span>, and metadata in one catalog';
  }
  if (lead) {
    lead.textContent = isDlc
      ? "Browse titles with downloadable add-on packs and title updates — open a tile to view and download files."
      : "Search thousands of titles with cover art, ratings, and downloadable archives — built for preservation and easy rediscovery.";
  }
  if (gamesStat) gamesStat.classList.toggle("site-hero-stat--muted", isDlc);
  if (addonsStat) addonsStat.classList.toggle("site-hero-stat--emphasis", isDlc);
  if (featuredTitle) featuredTitle.textContent = isDlc ? "Titles with Add-ons" : "Top Rated";
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

function updateFilterDrawerChrome(): void {
  const badge = document.getElementById("browseFilterBadge");
  const toggle = document.getElementById("browseFilterToggle");
  const sort = getDropdownValue("sort") || "rating";
  const drawerCount = (sort !== "rating" ? 1 : 0) + (settings.r !== "all" ? 1 : 0);
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
  const chipCount =
    drawerCount +
    (activeGenre && category === "Game" ? 1 : 0) +
    (query ? 1 : 0);

  if (badge) {
    if (drawerCount) {
      badge.textContent = String(drawerCount);
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
  }

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
    setDropdownValue("sort", "rating");
    syncRegion("all");
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

  grid.querySelector("[data-clear-genre]")?.addEventListener("click", () => setGenreFilter(null, { scroll: false }));
  grid.querySelector("[data-clear-region]")?.addEventListener("click", () => syncRegion("all"));
  grid.querySelector("[data-clear-all]")?.addEventListener("click", () => {
    activeGenre = null;
    syncGenreToUrl(null, true);
    const input = document.getElementById("q") as HTMLInputElement | null;
    if (input) input.value = "";
    syncRegion("all");
    renderGenreRail();
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
  if (addonsEl) addonsEl.innerHTML = `<strong>${addonCount.toLocaleString()}</strong> add-ons`;

  const pool = siteHeroCandidates();
  const picks = randomSample(pool, 7);
  const bgPicks = picks.slice(0, 4);
  const coverPicks = picks.slice(4, 7);

  slides.innerHTML = bgPicks
    .map(
      (entry, index) =>
        `<div class="site-hero-slide" style="--slide-index:${index};background-image:url('${bgUrl(entry.title_id)}')"></div>`
    )
    .join("");

  covers.innerHTML = "";
  coverPicks.forEach((entry, index) => {
    const card = document.createElement("div");
    card.className = "site-hero-cover";
    card.style.setProperty("--cover-index", String(index));
    card.innerHTML = `<img src="${coverUrl(entry.title_id)}" alt="" loading="lazy" />`;
    covers.appendChild(card);
  });
}

function bindSiteHeroEvents(): void {
  document.getElementById("siteHeroBrowse")?.addEventListener("click", () => {
    scrollBelowHeader(document.getElementById("grid"));
  });
  document.getElementById("siteHeroSearch")?.addEventListener("click", () => {
    const input = document.getElementById("q") as HTMLInputElement | null;
    input?.focus();
    scrollBelowHeader(input);
  });
}

function featuredCandidates(): TitleEntry[] {
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

  const candidates = featuredCandidates();
  const top = randomSample(candidates, 3);
  hGrid.innerHTML = "";

  if (!top.length) {
    hGrid.innerHTML = `<p class="browse-featured-empty">No featured titles for the current filters.</p>`;
    return;
  }

  const eyebrow = category === "DLC" ? "Has Add-ons" : "Top Rated";
  for (const game of top) {
    const card = createHeroCard(game, {
      eyebrow,
      backgroundUrl: gameBackgroundUrl(game),
      onActivate: (entry) => {
        if (category === "DLC") {
          const gridCard = document.querySelector<HTMLButtonElement>(`.browse-card[data-title-id="${entry.title_id}"]`);
          if (gridCard) openShelf(gridCard, entry);
          else openGamePage(entry);
        } else {
          openGamePage(entry);
        }
      }
    });
    hGrid.appendChild(card);
  }
  observeRevealChildren(hGrid, ".browse-hero-card", 45);
}

function closeShelf(): void {
  shelfEl?.classList.remove("open");
  document.body.classList.remove("dimmed");
  if (activeTile) {
    activeTile.classList.remove("active");
  }
  activeTile = null;
}

function openShelf(card: HTMLElement, game: TitleEntry): void {
  if (!shelfEl) return;
  if (activeTile === card) {
    closeShelf();
    return;
  }
  if (activeTile) activeTile.classList.remove("active");
  activeTile = card;
  card.classList.add("active");
  document.body.classList.add("dimmed");

  const sTitle = document.getElementById("sTitle");
  const sGrid = document.getElementById("sGrid");
  if (!sTitle || !sGrid) return;

  sTitle.innerHTML = `<img class="browse-shelf-icon" src="${iconUrl(game)}" alt="" />${game.name} Addons`;
  sGrid.innerHTML = "";
  const items = game.downloads.filter((d) => d.type === "DLC" || d.type === "Update");
  for (const d of items) {
    if (!d.url) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "s-item";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleDownload(d.url, d.filename, event.currentTarget as HTMLButtonElement);
    });
    const display = formatDownloadDisplay(d.label ?? d.filename);
    const meta = display.meta ? `<div class="dl-meta">${display.meta}</div>` : "";
    button.innerHTML = `<div><div style="font-size:0.7rem;color:#888">${d.type === "Update" ? "UPDATE" : "ADDON"}</div><b>${display.title}</b>${meta}</div><span style="color:var(--green)"><i class="fa-solid fa-download"></i></span>`;
    sGrid.appendChild(button);
  }

  window.setTimeout(() => {
    shelfEl?.classList.add("open");
    shelfEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 30);
}

function renderPageTiles(): void {
  const grid = document.getElementById("grid");
  if (!grid) return;

  const { start, end } = pageBounds(currentPage, grid);
  const batch = filtered.slice(start, end);
  grid.innerHTML = "";
  if (!filtered.length) {
    renderEmptyCatalog();
    return;
  }
  if (!batch.length) return;

  const frag = document.createDocumentFragment();
  for (const game of batch) {
    let badge = "";
    if (category === "DLC") badge = "DLC Inside";
    else if (game.downloads.some((d) => d.type === "DLC")) badge = "Has Addons";

    const card = createGridCard(game, {
      badge,
      dimmed: !game.downloads?.length,
      onActivate: (node, entry) => {
        if (category === "DLC") openShelf(node, entry);
        else openGamePage(entry);
      }
    });
    card.dataset.titleId = game.title_id;
    const img = card.querySelector<HTMLImageElement>("img");
    if (img) img.src = coverUrl(game.title_id);
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  const cols = getGridColumnCount(grid);
  grid.querySelectorAll<HTMLImageElement>(".browse-card img").forEach((img, index) => {
    if (index < cols) img.fetchPriority = "high";
  });
  observeRevealFirstRow(grid, ".browse-card", cols, 35);
}

function setPage(page: number, scrollToGrid = true): void {
  const grid = document.getElementById("grid");
  const totalPages = grid ? pageCountForGrid(grid) : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const nextPage = Math.min(Math.max(1, page), totalPages);
  if (nextPage !== currentPage) {
    closeShelf();
  }
  currentPage = nextPage;
  renderPageTiles();
  renderPagination();
  if (scrollToGrid) {
    document.getElementById("grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderPagination(): void {
  const pager = document.getElementById("pager");
  const grid = document.getElementById("grid");
  if (!pager) return;
  if (!filtered.length) {
    pager.innerHTML = "";
    return;
  }

  const totalPages = grid ? pageCountForGrid(grid) : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const bounds = grid ? pageBounds(currentPage, grid) : { start: 0, end: filtered.length };
  const start = bounds.start + 1;
  const end = bounds.end;
  const pageStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageEnd = Math.min(totalPages, pageStart + 4);
  let html = `<button type="button" class="page-btn nav" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;

  for (let page = pageStart; page <= pageEnd; page += 1) {
    html += `<button type="button" class="page-btn ${page === currentPage ? "active" : ""}" data-page="${page}">${page}</button>`;
  }

  html += `<button type="button" class="page-btn nav" data-page="${currentPage + 1}" ${
    currentPage === totalPages ? "disabled" : ""
  }><i class="fa-solid fa-chevron-right"></i></button>`;
  html += `<span class="page-meta">Showing ${start}-${end} of ${filtered.length}</span>`;
  pager.innerHTML = html;
  pager.querySelectorAll<HTMLButtonElement>(".page-btn[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.page);
      if (Number.isFinite(target)) setPage(target);
    });
  });
}

function updateGamesOnlyChrome(): void {
  document.querySelectorAll<HTMLElement>(".games-only").forEach((node) => {
    node.classList.toggle("hidden", category !== "Game");
  });
}

function renderGenreRail(): void {
  const rail = document.getElementById("genreRail");
  const countEl = document.getElementById("genreCount");
  if (countEl) countEl.textContent = `${GENRE_FILTERS.length} genres`;
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
}

function renderActiveFilters(): void {
  const bar = document.getElementById("browseFilterBar");
  if (!bar) return;
  const chips: string[] = [];
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";

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
    scrollBelowHeader(document.getElementById("genreSection"));
  }
}

function bindGenreEvents(): void {
  document.getElementById("genreRail")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".genre-chip");
    if (!button?.dataset.genre) return;
    const slug = button.dataset.genre;
    setGenreFilter(activeGenre === slug ? null : slug);
  });
  document.getElementById("browseFilterBar")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
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
      syncGenreToUrl(null, true);
      const input = document.getElementById("q") as HTMLInputElement | null;
      if (input) input.value = "";
      syncRegion("all");
      renderGenreRail();
      renderActiveFilters();
      applyFilters();
    }
  });
}

function applyFilters(): void {
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.toLowerCase() ?? "";
  const sort = getDropdownValue("sort") || "rating";
  const cnt = document.getElementById("cnt");
  const title = document.getElementById("lTitle");
  if (title) {
    if (activeGenre && category === "Game") {
      title.textContent = genreLabel(activeGenre);
    } else {
      title.textContent = category === "Game" ? "All Games" : "Addons & DLC";
    }
  }
  closeShelf();

  filtered = db.filter((g) => {
    if (/demo|beta|trial/i.test(g.name)) return false;
    const nameMatch = g.name.toLowerCase().includes(query);
    const dlcMatch = g.downloads.some((d) => (d.type === "DLC" || d.type === "Update") && d.filename.toLowerCase().includes(query));
    const match = category === "DLC" ? nameMatch || dlcMatch : nameMatch;
    const catMatch =
      category === "Game"
        ? g.downloads.length === 0 || g.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM" || d.type === "Mirror")
        : g.downloads.some((d) => d.type === "DLC" || d.type === "Update");
    const regMatch =
      settings.r === "all" || (g.regions ? g.regions.includes(settings.r) || g.regions.includes("World") : false);
    const genreMatch = category === "Game" && matchesGenreFilter(g, activeGenre);
    return category === "DLC" ? match && catMatch : match && catMatch && regMatch && genreMatch;
  });

  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "newest") return (Date.parse(b.release_date ?? "") || 0) - (Date.parse(a.release_date ?? "") || 0);
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  if (cnt) cnt.textContent = `${filtered.length.toLocaleString()} titles`;
  currentPage = 1;
  setPage(1, false);
  renderActiveFilters();
  updateGamesOnlyChrome();
}

function switchCategory(next: Category): void {
  if (document.body.classList.contains("profile-view")) {
    closeProfilePage();
  }
  if (document.body.classList.contains("game-view")) {
    closeGamePage();
  }
  if (next === "DLC" && activeGenre) {
    activeGenre = null;
    syncGenreToUrl(null, false);
  }
  category = next;
  document.getElementById("p-Game")?.classList.toggle("active", next === "Game");
  document.getElementById("p-DLC")?.classList.toggle("active", next === "DLC");
  updateBrowseModeChrome();
  renderHeroRows();
  renderGenreRail();
  applyFilters();
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
  document.getElementById("dimmer")?.addEventListener("click", () => closeShelf());
  document.getElementById("btt")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.getElementById("close-settings")?.addEventListener("click", () => closeSettings());
  document.getElementById("save-settings")?.addEventListener("click", () => saveSettings());
  document.getElementById("close-shelf")?.addEventListener("click", () => closeShelf());
  document.getElementById("close-game-page")?.addEventListener("click", () => closeGamePage());
  document.getElementById("gp-download-btn")?.addEventListener("click", () => openDownloadModal());
  document.getElementById("close-download-mod")?.addEventListener("click", () => closeDownloadModal());
  document.getElementById("p-Game")?.addEventListener("click", () => switchCategory("Game"));
  document.getElementById("p-DLC")?.addEventListener("click", () => switchCategory("DLC"));
  bindSiteHeroEvents();
  bindGenreEvents();
  bindFilterDrawer();
  let searchTimer = 0;
  document.getElementById("q")?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applyFilters(), 150);
  });
  bindFormControlGlobals();
  mountDropdown("sort", () => {
    applyFilters();
    updateFilterDrawerChrome();
  });
  mountDropdown("browseReg", () => syncRegion(getDropdownValue("browseReg")));
  mountDropdown("reg");
  initFormControls();
  document.getElementById("setMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById("downloadMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDownloadModal();
  });
  window.addEventListener("xbx-close-game", (event) => {
    const push = (event as CustomEvent<{ push?: boolean }>).detail?.push ?? false;
    closeGamePage(push);
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
      const totalPages = pageCountForGrid(grid);
      if (currentPage > totalPages) currentPage = totalPages;
      renderPageTiles();
      renderPagination();
    }, 150);
  });
}

async function bootstrap(): Promise<void> {
  renderShell();
  initScrollLock();
  syncDefaultHead();
  setupSettings();
  renderSkeletonTiles();
  shelfEl = document.getElementById("dlcShelf");
  bindStaticEvents();
  bindAuthUi();
  bindCollectionUi();
  const [, rows] = await Promise.all([initAuth(), loadTitles()]);
  db = rows;
  renderSiteHero();
  updateBrowseModeChrome();
  renderHeroRows();
  activeGenre = readGenreFromUrl();
  renderGenreRail();
  applyFilters();

  const initialId = new URLSearchParams(window.location.search).get("title");
  const initialProfile = new URLSearchParams(window.location.search).get("profile");
  if (initialProfile) {
    await syncProfileRouteFromUrl();
  } else if (initialId) {
    const found = db.find((g) => g.title_id === initialId);
    if (found) openGamePage(found, false);
  }
  window.addEventListener("popstate", () => {
    if (new URLSearchParams(window.location.search).get("profile")) return;
    const id = new URLSearchParams(window.location.search).get("title");
    if (id) {
      const found = db.find((g) => g.title_id === id);
      if (found) openGamePage(found, false);
      else closeGamePage(false);
      return;
    }
    closeGamePage(false);
    activeGenre = readGenreFromUrl();
    renderGenreRail();
    applyFilters();
  });
}

bootstrap().catch((error: unknown) => {
  if (root) {
    root.innerHTML = `<div class="app-error">Error loading DB: ${error instanceof Error ? error.message : "unknown"}</div>`;
  }
});
