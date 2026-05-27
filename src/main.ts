import "./styles.css";
import { coverUrl, loadTitles } from "./data";
import type { DownloadEntry, TitleEntry } from "./types";

type Category = "Game" | "DLC";
type TabName = "ov" | "dl" | "gal";

type Settings = {
  th: string;
  r: string;
};

const THEME_COLORS = ["#107C10", "#0078D7", "#E81123", "#881798", "#FFB900"];

/** Production: absolute URL (e.g. Cloudflare Workers). Dev: empty ⇒ same-origin `/download`, forwarded by Vite to local proxy — see vite.config.ts. */
function downloadProxyBase(): string | null {
  const fromEnv = (import.meta.env.VITE_DOWNLOAD_PROXY_ORIGIN as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "";
  }
  return null;
}

const root = document.querySelector<HTMLDivElement>("#app");

let db: TitleEntry[] = [];
let filtered: TitleEntry[] = [];
let renderedCount = 0;
let category: Category = "Game";
let activeTile: HTMLElement | null = null;
let shelfEl: HTMLElement | null = null;
const settings: Settings = {
  th: window.localStorage.getItem("x_th") ?? "#107C10",
  r: window.localStorage.getItem("x_r") ?? "all"
};

function proxiedUrl(download: DownloadEntry): string | null {
  const base = downloadProxyBase();
  if (base === null) return null;
  const path = `/download?key=${encodeURIComponent(download.filename)}`;
  return base === "" ? path : `${base}${path}`;
}

function bgUrl(entry: TitleEntry): string {
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${entry.title_id}/artwork/background.jpg`;
}

function bannerUrl(entry: TitleEntry): string {
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${entry.title_id}/artwork/banner.png`;
}

function iconUrl(entry: TitleEntry): string {
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${entry.title_id}/artwork/icon.png`;
}

function stripName(filename: string): string {
  return filename
    .replace(/\.zip$|\.iso$|\.7z$/i, "")
    .replace(/\(World\)|\(USA\)|\(Europe\)|\(Japan\)|\(Addon\)|\(DLC\)|\(Update\)|\[.*?\]/gi, "")
    .trim();
}

function stars(rating: number | null | undefined): string {
  let html = '<span class="stars">';
  const rounded = Math.round(rating ?? 0);
  for (let i = 0; i < 5; i += 1) {
    html += i < rounded ? "★" : '<span style="color:#444">★</span>';
  }
  return `${html}</span>`;
}

function dedupeTitles(rows: TitleEntry[]): TitleEntry[] {
  const map = new Map<string, TitleEntry>();
  for (const game of rows) {
    const key = game.name.trim().toLowerCase();
    const prev = map.get(key);
    const score = (game.rating ?? 0) + (game.developer ? 1 : 0);
    const prevScore = (prev?.rating ?? 0) + (prev?.developer ? 1 : 0);
    if (!prev || score > prevScore) {
      map.set(key, game);
    }
  }
  return [...map.values()];
}

function renderSkeletonTiles(): void {
  const grid = document.getElementById("grid");
  if (!grid) return;
  let html = "";
  for (let i = 0; i < 20; i += 1) {
    html += '<div class="tile skeleton"><div class="tile-ov"></div></div>';
  }
  grid.innerHTML = html;
}

function renderShell(): void {
  if (!root) throw new Error("Missing app root");
  root.innerHTML = `
    <div id="dimmer"></div>
    <div id="btt">↑</div>
    <header class="header">
      <div class="top-bar">
        <div class="brand"><h1>xbx.<span>place</span></h1></div>
        <div class="controls">
          <input id="q" class="inp" placeholder="Search..." style="width:250px" />
          <button class="icon-btn" id="open-settings">⚙</button>
          <a href="https://discord.gg/example" target="_blank" class="btn" rel="noreferrer"><span>Join Discord</span></a>
        </div>
      </div>
      <div class="pivots">
        <div class="pivot active" id="p-Game">GAMES</div>
        <div class="pivot" id="p-DLC">ADDONS & DLC</div>
      </div>
    </header>
    <div class="container">
      <div class="sec-title">
        <span>Featured & Top Rated</span>
        <div style="display:flex;gap:15px;align-items:center">
          <select id="sort" class="sel" style="padding:4px 10px">
            <option value="rating">Best Rated</option>
            <option value="name">A-Z</option>
            <option value="newest">Newest</option>
          </select>
          <span id="cnt" style="font-size:0.9rem"></span>
        </div>
      </div>
      <div class="hero-grid" id="hGrid"></div>
      <div class="sec-title"><span id="lTitle">All Games</span></div>
      <div class="grid" id="grid"></div>
      <div id="sentinel" style="text-align:center;padding:20px;color:#666">Loading more...</div>
      <div id="dlcShelf" class="shelf">
        <div style="padding:0 20px">
          <div style="margin-bottom:15px;display:flex;justify-content:space-between;color:#ddd;font-size:1.2rem">
            <div id="sTitle"></div>
            <button id="close-shelf" style="background:0;border:0;color:#666;font-size:1.5rem;cursor:pointer">&times;</button>
          </div>
          <div id="sGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px"></div>
        </div>
      </div>
    </div>
    <div class="overlay" id="setMod">
      <div class="blade sm">
        <div class="m-head" style="background:#252525;padding:20px;display:flex;justify-content:space-between">
          <h2 style="font-size:1.5rem">Settings</h2>
          <button class="close" id="close-settings" style="position:static">&times;</button>
        </div>
        <div class="settings-content">
          <div class="group"><label>Theme Color</label><div class="dots" id="thPick"></div></div>
          <div class="group">
            <label>Default Region</label>
            <select id="reg" class="sel" style="width:100%">
              <option value="all">All Regions</option>
              <option value="USA">🇺🇸 USA</option>
              <option value="Europe">🇪🇺 Europe</option>
              <option value="Japan">🇯🇵 Japan</option>
              <option value="World">🌍 World / Region Free</option>
            </select>
          </div>
        </div>
        <div style="padding:20px;background:#151515;text-align:right">
          <button class="btn" id="save-settings" style="background:var(--green);display:inline-block">Save & Reload</button>
        </div>
      </div>
    </div>
    <footer class="footer">
      <div>
        <div style="color:#fff;margin-bottom:5px;font-size:1.1rem">xbx.place</div>
        <div>The premier archive for X360 content.</div>
      </div>
      <div class="footer-links">
        <a href="#">About</a><a href="#">DMCA</a><a href="#">Donate</a><a href="https://discord.gg/example">Discord</a>
      </div>
    </footer>
    <div class="overlay" id="modal">
      <div class="blade lg">
        <div style="position:absolute;width:100%;height:100%;z-index:0"><img id="m-bg" class="m-bg" src="" /></div>
        <button class="close" id="close-modal">&times;</button>
        <div class="m-l"><img src="" class="m-cover" id="m-cov" /></div>
        <div class="m-r">
          <div class="m-head">
            <img id="m-ban" class="m-banner" src="" />
            <h2 id="m-tit"></h2>
            <div class="meta"><div id="m-rate"></div><span id="m-yr"></span></div>
          </div>
          <div class="tabs">
            <div class="tab active" data-tab="ov">Overview</div>
            <div class="tab" data-tab="dl">Downloads</div>
            <div class="tab" data-tab="gal">Gallery</div>
          </div>
          <div id="t-ov" class="tab-c active">
            <div id="m-desc" style="font-size:0.95rem;line-height:1.6;color:#ddd"></div>
            <div class="info-g">
              <div><span class="info-l">Developer</span><span id="m-dev"></span></div>
              <div><span class="info-l">Publisher</span><span id="m-pub"></span></div>
              <div><span class="info-l">Regions</span><span id="m-reg"></span></div>
            </div>
          </div>
          <div id="t-dl" class="tab-c"><div id="proxy-note" class="proxy-note hidden">Downloads need the local proxy. Run <code>npm run proxy</code> (port 8787) while using <code>npm run dev</code>, or set <code>VITE_DOWNLOAD_PROXY_ORIGIN</code> for production.</div><div id="dl-l"></div></div>
          <div id="t-gal" class="tab-c"><div id="g-g" class="g-grid"></div></div>
        </div>
      </div>
    </div>
  `;
}

function setTab(tab: TabName): void {
  document.querySelectorAll(".tab-c").forEach((node) => node.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((node) => node.classList.remove("active"));
  document.getElementById(`t-${tab}`)?.classList.add("active");
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");
}

function closeModal(push = true): void {
  document.getElementById("modal")?.classList.remove("show");
  if (push) {
    window.history.pushState(null, "", window.location.pathname);
  }
}

function openModal(game: TitleEntry, push = true): void {
  setTab("ov");
  const title = document.getElementById("m-tit");
  const desc = document.getElementById("m-desc");
  const dev = document.getElementById("m-dev");
  const pub = document.getElementById("m-pub");
  const reg = document.getElementById("m-reg");
  const rate = document.getElementById("m-rate");
  const year = document.getElementById("m-yr");
  const cover = document.getElementById("m-cov") as HTMLImageElement | null;
  const bg = document.getElementById("m-bg") as HTMLImageElement | null;
  const banner = document.getElementById("m-ban") as HTMLImageElement | null;
  const proxyNote = document.getElementById("proxy-note");
  const dlList = document.getElementById("dl-l");
  const gallery = document.getElementById("g-g");
  if (!title || !desc || !dev || !pub || !reg || !rate || !year || !cover || !bg || !banner || !dlList || !gallery || !proxyNote) return;

  title.textContent = game.name;
  desc.textContent = game.description ?? "No description.";
  dev.textContent = game.developer ?? "-";
  pub.textContent = game.publisher ?? "-";
  reg.textContent = game.regions?.join(", ") || "-";
  rate.innerHTML = stars(game.rating);
  year.textContent = game.release_date ?? "";
  cover.src = coverUrl(game.title_id);
  bg.src = bgUrl(game);
  banner.src = bannerUrl(game);
  banner.onerror = () => {
    banner.style.display = "none";
  };
  banner.style.display = "block";
  cover.onerror = () => {
    cover.src = "https://placehold.co/300x420/202020/ffffff.png?text=No+Cover";
  };

  dlList.innerHTML = "";
  proxyNote.classList.toggle("hidden", downloadProxyBase() !== null);
  const downloads = game.downloads ?? [];
  if (!downloads.length) {
    dlList.innerHTML = '<div style="color:#666">No downloads.</div>';
  } else {
    for (const dl of downloads) {
      if (!dl.url) continue;
      const target = proxiedUrl(dl);
      const button = document.createElement("button");
      button.type = "button";
      button.className = target ? "dl-btn" : "dl-btn dis";
      button.innerHTML = `<div><div style="font-size:0.7rem;color:#aaa">${(dl.type ?? "GAME").toUpperCase()}</div><b>${stripName(
        dl.label ?? dl.filename
      )}</b></div><span>⬇</span>`;
      if (target) {
        button.addEventListener("click", () => {
          window.open(target, "_blank", "noopener,noreferrer");
        });
      }
      dlList.appendChild(button);
    }
  }

  gallery.innerHTML = "";
  if (game.artwork?.gallery?.length) {
    for (const img of game.artwork.gallery) {
      const node = document.createElement("img");
      node.className = "g-img";
      node.src = img;
      node.loading = "lazy";
      node.addEventListener("click", () => window.open(node.src, "_blank", "noopener,noreferrer"));
      gallery.appendChild(node);
    }
  } else {
    gallery.innerHTML = '<div style="color:#666;grid-column:1/-1">No images.</div>';
  }

  if (push) {
    window.history.pushState({ id: game.title_id }, "", `?title=${game.title_id}`);
  }
  document.getElementById("modal")?.classList.add("show");
}

function openSettings(): void {
  document.getElementById("setMod")?.classList.add("show");
}

function closeSettings(): void {
  document.getElementById("setMod")?.classList.remove("show");
}

function renderHeroRows(): void {
  const hGrid = document.getElementById("hGrid");
  if (!hGrid) return;
  let candidates = db.filter(
    (g) => (g.rating ?? 0) >= 4.5 && !/demo|beta/i.test(g.name) && (settings.r === "all" || (g.regions ?? []).includes(settings.r))
  );
  if (candidates.length < 3) {
    candidates = db.filter((g) => (g.rating ?? 0) >= 4.0);
  }
  const top = [...candidates].sort(() => Math.random() - 0.5).slice(0, 3);
  hGrid.innerHTML = "";
  for (const g of top) {
    const d = document.createElement("div");
    d.className = "hero-card";
    d.innerHTML = `<img class="hero-bg" src="${bgUrl(g)}" /><div class="hero-info"><div style="font-size:1.4rem;text-shadow:0 2px 4px #000">${g.name}</div><div style="color:var(--green)">${stars(
      g.rating
    )}</div></div>`;
    d.addEventListener("click", () => openModal(g));
    hGrid.appendChild(d);
  }
}

function closeShelf(): void {
  shelfEl?.classList.remove("open");
  document.body.classList.remove("dimmed");
  if (activeTile) {
    activeTile.classList.remove("active");
  }
  activeTile = null;
}

function openShelf(tile: HTMLElement, game: TitleEntry): void {
  if (!shelfEl) return;
  if (activeTile === tile) {
    closeShelf();
    return;
  }
  if (activeTile) activeTile.classList.remove("active");
  activeTile = tile;
  tile.classList.add("active");
  document.body.classList.add("dimmed");

  const sTitle = document.getElementById("sTitle");
  const sGrid = document.getElementById("sGrid");
  if (!sTitle || !sGrid) return;

  sTitle.innerHTML = `<img src="${iconUrl(game)}" style="width:24px;vertical-align:middle;margin-right:10px" />${game.name} Addons`;
  sGrid.innerHTML = "";
  const items = game.downloads.filter((d) => d.type === "DLC" || d.type === "Update");
  for (const d of items) {
    const target = d.url ? proxiedUrl(d) : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = target ? "s-item" : "s-item dis";
    if (target) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        window.open(target, "_blank", "noopener,noreferrer");
      });
    }
    button.innerHTML = `<div><div style="font-size:0.7rem;color:#888">${d.type === "Update" ? "UPDATE" : "ADDON"}</div><b>${stripName(
      d.label ?? d.filename
    )}</b></div><span style="color:var(--green)">⬇</span>`;
    sGrid.appendChild(button);
  }

  const grid = document.getElementById("grid");
  if (!grid) return;
  let next = tile.nextElementSibling as HTMLElement | null;
  while (next && next.offsetTop === tile.offsetTop && next.id !== "sentinel") {
    next = next.nextElementSibling as HTMLElement | null;
  }
  grid.insertBefore(shelfEl, next);
  window.setTimeout(() => {
    shelfEl?.classList.add("open");
    shelfEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 30);
}

function loadMoreTiles(): void {
  const grid = document.getElementById("grid");
  const sentinel = document.getElementById("sentinel");
  if (!grid || !sentinel) return;

  const batch = filtered.slice(renderedCount, renderedCount + 50);
  if (!batch.length) {
    sentinel.style.display = "none";
    return;
  }
  sentinel.style.display = "block";
  const frag = document.createDocumentFragment();
  for (const game of batch) {
    const tile = document.createElement("div");
    tile.className = "tile skeleton";
    if (!game.downloads?.length) tile.classList.add("dim");
    const img = new Image();
    img.src = coverUrl(game.title_id);
    img.onload = () => tile.classList.remove("skeleton");
    img.onerror = () => {
      img.src = `https://placehold.co/170x235/202020/ffffff.png?text=${encodeURIComponent(game.name)}`;
      tile.classList.remove("skeleton");
    };
    let badge = "";
    if (category === "DLC") badge = "DLC Inside";
    else if (game.downloads.some((d) => d.type === "DLC")) badge = "Has Addons";

    const ov = document.createElement("div");
    ov.className = "tile-ov";
    ov.innerHTML = `<div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${game.name}</div>${
      badge ? `<span class="badge">${badge}</span>` : ""
    }`;

    tile.appendChild(img);
    tile.appendChild(ov);
    tile.addEventListener("click", (event) => {
      event.stopPropagation();
      if (category === "DLC") openShelf(tile, game);
      else openModal(game);
    });
    frag.appendChild(tile);
  }
  grid.appendChild(frag);
  renderedCount += batch.length;
}

function applyFilters(): void {
  const query = (document.getElementById("q") as HTMLInputElement | null)?.value.toLowerCase() ?? "";
  const sort = (document.getElementById("sort") as HTMLSelectElement | null)?.value ?? "rating";
  const cnt = document.getElementById("cnt");
  const title = document.getElementById("lTitle");
  if (title) {
    title.textContent = category === "Game" ? "All Games" : "Addons & DLC";
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
    return category === "DLC" ? match && catMatch : match && catMatch && regMatch;
  });

  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "newest") return (Date.parse(b.release_date ?? "") || 0) - (Date.parse(a.release_date ?? "") || 0);
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  if (cnt) cnt.textContent = `${filtered.length} found`;
  const grid = document.getElementById("grid");
  if (grid) grid.innerHTML = "";
  renderedCount = 0;
  loadMoreTiles();
}

function switchCategory(next: Category): void {
  category = next;
  document.getElementById("p-Game")?.classList.toggle("active", next === "Game");
  document.getElementById("p-DLC")?.classList.toggle("active", next === "DLC");
  applyFilters();
}

function setupSettings(): void {
  document.documentElement.style.setProperty("--green", settings.th);
  const picker = document.getElementById("thPick");
  const reg = document.getElementById("reg") as HTMLSelectElement | null;
  if (!picker || !reg) return;
  picker.innerHTML = "";
  for (const color of THEME_COLORS) {
    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background = color;
    if (color === settings.th) dot.classList.add("active");
    dot.addEventListener("click", () => {
      settings.th = color;
      document.documentElement.style.setProperty("--green", color);
      document.querySelectorAll(".dot").forEach((node) => node.classList.remove("active"));
      dot.classList.add("active");
    });
    picker.appendChild(dot);
  }
  reg.value = settings.r;
}

function saveSettings(): void {
  const reg = document.getElementById("reg") as HTMLSelectElement | null;
  settings.r = reg?.value ?? "all";
  window.localStorage.setItem("x_th", settings.th);
  window.localStorage.setItem("x_r", settings.r);
  closeSettings();
  renderHeroRows();
  applyFilters();
}

function bindStaticEvents(): void {
  document.getElementById("dimmer")?.addEventListener("click", () => closeShelf());
  document.getElementById("btt")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.getElementById("open-settings")?.addEventListener("click", () => openSettings());
  document.getElementById("close-settings")?.addEventListener("click", () => closeSettings());
  document.getElementById("save-settings")?.addEventListener("click", () => saveSettings());
  document.getElementById("close-shelf")?.addEventListener("click", () => closeShelf());
  document.getElementById("close-modal")?.addEventListener("click", () => closeModal());
  document.getElementById("p-Game")?.addEventListener("click", () => switchCategory("Game"));
  document.getElementById("p-DLC")?.addEventListener("click", () => switchCategory("DLC"));
  document.getElementById("q")?.addEventListener("input", () => applyFilters());
  document.getElementById("sort")?.addEventListener("change", () => applyFilters());
  document.getElementById("setMod")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  document.getElementById("modal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.querySelectorAll<HTMLElement>(".tab").forEach((node) => {
    node.addEventListener("click", () => setTab((node.dataset.tab as TabName | undefined) ?? "ov"));
  });
  window.addEventListener("scroll", () => {
    document.getElementById("btt")?.classList.toggle("show", window.scrollY > 500);
  });
}

async function bootstrap(): Promise<void> {
  renderShell();
  setupSettings();
  renderSkeletonTiles();
  shelfEl = document.getElementById("dlcShelf");
  bindStaticEvents();

  const rows = await loadTitles();
  db = dedupeTitles(rows);
  renderHeroRows();
  applyFilters();

  const sentinel = document.getElementById("sentinel");
  if (sentinel) {
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && renderedCount < filtered.length) loadMoreTiles();
      },
      { rootMargin: "200px" }
    );
    obs.observe(sentinel);
  }

  const initialId = new URLSearchParams(window.location.search).get("title");
  if (initialId) {
    const found = db.find((g) => g.title_id === initialId);
    if (found) openModal(found, false);
  }
  window.addEventListener("popstate", () => {
    const id = new URLSearchParams(window.location.search).get("title");
    if (!id) {
      closeModal(false);
      return;
    }
    const found = db.find((g) => g.title_id === id);
    if (found) openModal(found, false);
  });
}

bootstrap().catch((error: unknown) => {
  if (root) {
    root.innerHTML = `<div style="color:red;padding:20px">Error loading DB: ${error instanceof Error ? error.message : "unknown"}</div>`;
  }
});
