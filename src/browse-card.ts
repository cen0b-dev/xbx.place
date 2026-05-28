import { bindCroppedCover } from "./cover-crop";
import { coverUrl } from "./data";
import type { TitleEntry } from "./types";

export function stars(rating: number | null | undefined): string {
  let html = '<span class="stars">';
  const rounded = Math.round(rating ?? 0);
  for (let i = 0; i < 5; i += 1) {
    html += i < rounded ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-solid fa-star off"></i>';
  }
  return `${html}</span>`;
}

export function ratingScore(rating: number | null | undefined): number {
  return Math.round(((rating ?? 0) / 5) * 100);
}

export function ratingScoreTier(score: number): string {
  if (score >= 90) return "exceptional";
  if (score >= 80) return "great";
  if (score >= 70) return "good";
  if (score > 0) return "low";
  return "muted";
}

export function communityScoreBadgeHtml(
  rating: number | null | undefined,
  className = "browse-tile-score"
): string {
  const score = ratingScore(rating);
  const tier = ratingScoreTier(score);
  if (score === 0) {
    return `<span class="${className} browse-tile-score--unrated" title="Not rated yet">NR</span>`;
  }
  return `<span class="${className} browse-tile-score--${tier}" title="Community score: ${score}">${score}</span>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function primaryGenre(game: TitleEntry): string {
  return game.genre?.[0]?.trim() ?? "";
}

const SUPPRESSED_GENRES = new Set(["other", "unknown", "misc", "miscellaneous", ""]);

function displayGenre(game: TitleEntry): string {
  const genre = primaryGenre(game);
  if (!genre || SUPPRESSED_GENRES.has(genre.toLowerCase())) return "";
  return genre;
}

function formatRatingLabel(rating: number | null | undefined): string {
  const value = rating ?? 0;
  if (value <= 0) return "";
  return `★ ${value.toFixed(1)}`;
}

function hoverMetaParts(game: TitleEntry): string[] {
  const parts: string[] = [];
  const year = game.release_date ? game.release_date.slice(0, 4) : "";
  if (year) parts.push(year);
  const genre = displayGenre(game);
  if (genre) parts.push(genre);
  const rating = formatRatingLabel(game.rating);
  if (rating) parts.push(rating);
  return parts;
}

function tileMetaHtml(game: TitleEntry): string {
  return `
    ${communityScoreBadgeHtml(game.rating)}
    <div class="browse-tile-meta-copy">
      <div class="browse-card-name" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</div>
      <div class="browse-tile-rating">${stars(game.rating)}</div>
    </div>
  `;
}

function hoverPanelHtml(game: TitleEntry): string {
  const metaParts = hoverMetaParts(game);

  return `
    <div class="browse-card-hover" aria-hidden="true">
      <div class="browse-card-hover-title">${escapeHtml(game.name)}</div>
      ${metaParts.length ? `<div class="browse-card-hover-meta">${escapeHtml(metaParts.join(" · "))}</div>` : ""}
      <span class="browse-card-hover-cta">Details</span>
    </div>
  `;
}

function bindBrowseCardImage(card: HTMLElement, img: HTMLImageElement, game: TitleEntry, rawSrc?: string): void {
  img.decoding = "async";
  card.classList.add("is-loading");
  const src = rawSrc ?? coverUrl(game.title_id);
  const fallbackSrc = `https://placehold.co/280x390/202020/ffffff.png?text=${encodeURIComponent(game.name)}`;
  bindCroppedCover(img, src, {
    onReady: () => {
      card.classList.remove("is-loading");
      card.classList.add("is-loaded");
    },
    onError: () => {
      img.removeAttribute("crossorigin");
      img.src = fallbackSrc;
      card.classList.remove("is-loading");
      card.classList.add("is-loaded");
    },
    fallbackSrc
  });
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

type AddonListCardOptions = {
  subtitle: string;
  coverSrc: string;
  dimmed?: boolean;
  onActivate: (node: HTMLButtonElement, entry: TitleEntry) => void;
};

export function createAddonListCard(game: TitleEntry, options: AddonListCardOptions): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "game-rec-card addon-list-card is-loading";
  if (options.dimmed) card.classList.add("addon-list-card--dim");
  card.dataset.titleId = game.title_id;
  card.setAttribute("aria-label", `${game.name} — ${options.subtitle}`);

  card.innerHTML = `
    <div class="game-rec-cover cover-crop-view">
      <img alt="" loading="lazy" />
    </div>
    <div class="game-rec-copy">
      <div class="game-rec-name"></div>
      <div class="game-rec-genre"></div>
    </div>
    <span class="addon-list-cta" aria-hidden="true">
      <i class="fa-solid fa-chevron-right"></i>
    </span>
  `;

  card.querySelector(".game-rec-name")!.textContent = game.name;
  card.querySelector(".game-rec-genre")!.textContent = options.subtitle;

  const img = card.querySelector<HTMLImageElement>("img");
  if (img) {
    img.alt = game.name;
    bindBrowseCardImage(card, img, game, options.coverSrc);
  }

  card.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onActivate(card, game);
  });
  return card;
}

export function createGridCard(game: TitleEntry, options: GridCardOptions): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "browse-card is-loading";
  if (options.dimmed) card.classList.add("browse-card--dim");
  card.dataset.titleId = game.title_id;
  card.setAttribute("aria-label", game.name);

  const media = document.createElement("div");
  media.className = "browse-card-media cover-crop-view";

  const img = document.createElement("img");
  img.alt = game.name;
  img.loading = "lazy";
  bindBrowseCardImage(card, img, game);
  media.appendChild(img);

  if (options.badge) {
    const badgeEl = document.createElement("div");
    badgeEl.className = "browse-card-addon-badge";
    badgeEl.textContent = options.badge;
    media.appendChild(badgeEl);
  }

  const ov = document.createElement("div");
  ov.className = "browse-card-ov";
  ov.innerHTML = tileMetaHtml(game);

  card.appendChild(media);
  card.appendChild(ov);
  card.insertAdjacentHTML("beforeend", hoverPanelHtml(game));
  card.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onActivate(card, game);
  });
  return card;
}

type HeroCardOptions = {
  eyebrow: string;
  rank?: number;
  backgroundUrl: string;
  onActivate: (entry: TitleEntry) => void;
};

export function createHeroCard(game: TitleEntry, options: HeroCardOptions): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "browse-hero-card is-loading";
  card.setAttribute("aria-label", game.name);

  const year = game.release_date ? game.release_date.slice(0, 4) : "";
  const rankMarkup =
    options.rank != null ? `<span class="browse-hero-rank" aria-hidden="true">#${options.rank}</span>` : "";
  card.innerHTML = `
    <img class="browse-hero-bg" alt="" />
    <div class="browse-hero-shade" aria-hidden="true"></div>
    ${rankMarkup}
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
