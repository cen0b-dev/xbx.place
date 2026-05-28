import type { TitleEntry } from "./types";

export type GenreFilter = {
  slug: string;
  label: string;
  icon: string;
  match: string[];
};

export const GENRE_FILTERS: GenreFilter[] = [
  { slug: "action", label: "Action", icon: "fa-burst", match: ["Action & Adventure"] },
  { slug: "shooter", label: "Shooter", icon: "fa-crosshairs", match: ["Shooter"] },
  { slug: "rpg", label: "RPG", icon: "fa-khanda", match: ["Role Playing"] },
  { slug: "racing", label: "Racing", icon: "fa-flag-checkered", match: ["Racing & Flying"] },
  { slug: "sports", label: "Sports", icon: "fa-futbol", match: ["Sports & Recreation", "Sports"] },
  { slug: "fighting", label: "Fighting", icon: "fa-hand-fist", match: ["Fighting"] },
  { slug: "strategy", label: "Strategy", icon: "fa-chess-knight", match: ["Strategy & Simulation"] },
  { slug: "family", label: "Family", icon: "fa-people-group", match: ["Family"] },
  { slug: "platformer", label: "Platformer", icon: "fa-gamepad", match: ["Platformer"] },
  { slug: "music", label: "Music", icon: "fa-music", match: ["Music"] },
  { slug: "puzzle", label: "Puzzle", icon: "fa-puzzle-piece", match: ["Puzzle & Trivia"] }
];

export function genreLabel(slug: string): string {
  return GENRE_FILTERS.find((filter) => filter.slug === slug)?.label ?? slug;
}

export function isGenreSlug(slug: string | null | undefined): slug is string {
  return Boolean(slug && GENRE_FILTERS.some((filter) => filter.slug === slug));
}

export function readGenreFromUrl(): string | null {
  const slug = new URLSearchParams(window.location.search).get("genre");
  return isGenreSlug(slug) ? slug : null;
}

export function syncGenreToUrl(genre: string | null, push = false): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("title");
  url.searchParams.delete("profile");
  if (genre) url.searchParams.set("genre", genre);
  else url.searchParams.delete("genre");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (push) window.history.pushState({ genre }, "", next);
  else window.history.replaceState({ genre }, "", next);
}

export function matchesGenreFilter(game: TitleEntry, slug: string | null): boolean {
  if (!slug) return true;
  const filter = GENRE_FILTERS.find((entry) => entry.slug === slug);
  if (!filter) return true;
  const genres = new Set((game.genre ?? []).map((value) => value.toLowerCase()));
  return filter.match.some((value) => genres.has(value.toLowerCase()));
}
