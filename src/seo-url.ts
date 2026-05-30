import { gamePagePathForTitle, loadGameSlugs, resolveTitleIdFromPath } from "./game-slugs";

const SITE_ORIGIN = "https://xbx.place";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

export { loadGameSlugs, gamePagePathForTitle as gamePagePath };

export function genrePagePath(slug: string): string {
  return `/genre/${encodeURIComponent(slug)}/`;
}

export function readGameIdFromUrl(): string | null {
  const match = /^\/game\/([^/]+)\/?$/i.exec(window.location.pathname);
  if (match?.[1]) {
    const resolved = resolveTitleIdFromPath(match[1]);
    if (resolved) return resolved;
  }
  const legacy = new URLSearchParams(window.location.search).get("title")?.trim();
  return legacy ? legacy.toUpperCase() : null;
}

export function syncGameToUrl(titleId: string, push = false): void {
  const next = `${gamePagePathForTitle(titleId)}${window.location.hash}`;
  if (push) window.history.pushState({ id: titleId }, "", next);
  else window.history.replaceState({ id: titleId }, "", next);
}

export function shouldNoindexPage(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("profile")?.trim()) return true;
  if (params.get("collection")?.trim()) return true;
  if (params.get("q")?.trim()) return true;
  if (params.get("package")?.trim()) return true;
  return false;
}

export function robotsMetaContent(): string {
  return shouldNoindexPage()
    ? "noindex, follow"
    : "index, follow, max-image-preview:large";
}

export function applyRobotsMeta(): void {
  const content = robotsMetaContent();
  let tag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", "robots");
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}
