import type { TitleEntry } from "./types";

export function stars(rating: number | null | undefined): string {
  let html = '<span class="stars">';
  const rounded = Math.round(rating ?? 0);
  for (let i = 0; i < 5; i += 1) {
    html += i < rounded ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-solid fa-star off"></i>';
  }
  return `${html}</span>`;
}

function ratingScore(rating: number | null | undefined): number {
  return Math.round(((rating ?? 0) / 5) * 100);
}

function ratingScoreTier(score: number): string {
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  if (score > 0) return "low";
  return "muted";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tileMetaHtml(game: TitleEntry, badge = ""): string {
  const score = ratingScore(game.rating);
  const tier = ratingScoreTier(score);
  return `
    <span class="browse-tile-score browse-tile-score--${tier}">${score}</span>
    <div class="browse-tile-meta-copy">
      <div class="browse-card-name">${escapeHtml(game.name)}</div>
      <div class="browse-tile-rating">${stars(game.rating)}</div>
      ${badge ? `<span class="game-tag browse-card-badge">${escapeHtml(badge)}</span>` : ""}
    </div>
  `;
}

function bindBrowseCardImage(card: HTMLElement, img: HTMLImageElement, game: TitleEntry): void {
  card.classList.add("is-loading");
  img.onload = () => {
    card.classList.remove("is-loading");
    card.classList.add("is-loaded");
  };
  img.onerror = () => {
    img.src = `https://placehold.co/170x235/202020/ffffff.png?text=${encodeURIComponent(game.name)}`;
    card.classList.remove("is-loading");
    card.classList.add("is-loaded");
  };
}

function bindHeroBackground(card: HTMLElement, img: HTMLImageElement): void {
  card.classList.add("is-loading");
  img.onload = () => {
    card.classList.remove("is-loading");
    card.classList.add("is-loaded");
  };
  img.onerror = () => {
    card.classList.remove("is-loading");
    card.classList.add("is-loaded");
  };
}

type GridCardOptions = {
  badge?: string;
  dimmed?: boolean;
  onActivate: (node: HTMLButtonElement, entry: TitleEntry) => void;
};

export function createGridCard(game: TitleEntry, options: GridCardOptions): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "browse-card is-loading";
  if (options.dimmed) card.classList.add("browse-card--dim");
  card.dataset.titleId = game.title_id;
  card.setAttribute("aria-label", game.name);

  const img = document.createElement("img");
  img.alt = game.name;
  img.loading = "lazy";
  bindBrowseCardImage(card, img, game);

  const ov = document.createElement("div");
  ov.className = "browse-card-ov";
  ov.innerHTML = tileMetaHtml(game, options.badge ?? "");

  card.appendChild(img);
  card.appendChild(ov);
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onActivate(card, game);
  });
  return card;
}

type HeroCardOptions = {
  eyebrow: string;
  backgroundUrl: string;
  onActivate: (entry: TitleEntry) => void;
};

export function createHeroCard(game: TitleEntry, options: HeroCardOptions): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "browse-hero-card is-loading";
  card.setAttribute("aria-label", game.name);

  const year = game.release_date ? game.release_date.slice(0, 4) : "";
  card.innerHTML = `
    <img class="browse-hero-bg" alt="" />
    <div class="browse-hero-shade" aria-hidden="true"></div>
    <div class="browse-hero-copy">
      <span class="browse-hero-eyebrow"></span>
      <span class="browse-hero-title"></span>
      <div class="browse-hero-meta">
        <span class="browse-hero-rating"></span>
        ${year ? `<span class="browse-hero-year">${year}</span>` : ""}
      </div>
    </div>
  `;

  card.querySelector(".browse-hero-eyebrow")!.textContent = options.eyebrow;
  card.querySelector(".browse-hero-title")!.textContent = game.name;
  const ratingEl = card.querySelector(".browse-hero-rating");
  if (ratingEl) ratingEl.innerHTML = stars(game.rating);

  const img = card.querySelector<HTMLImageElement>(".browse-hero-bg");
  if (img) {
    bindHeroBackground(card, img);
    img.src = options.backgroundUrl;
  }

  card.addEventListener("click", () => options.onActivate(game));
  return card;
}
