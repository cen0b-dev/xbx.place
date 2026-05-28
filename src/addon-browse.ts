import type { DownloadEntry, TitleEntry } from "./types";

export type AddonTypeSlug = "all" | "dlc" | "update";

export type AddonTypeFilter = {
  slug: AddonTypeSlug;
  label: string;
  icon: string;
};

export const ADDON_TYPE_FILTERS: AddonTypeFilter[] = [
  { slug: "all", label: "All Packages", icon: "fa-layer-group" },
  { slug: "dlc", label: "DLC & Add-ons", icon: "fa-puzzle-piece" },
  { slug: "update", label: "Title Updates", icon: "fa-arrow-up-from-bracket" }
];

export function addonTypeLabel(slug: AddonTypeSlug): string {
  return ADDON_TYPE_FILTERS.find((filter) => filter.slug === slug)?.label ?? slug;
}

export function isAddonTypeSlug(slug: string | null | undefined): slug is AddonTypeSlug {
  return Boolean(slug && ADDON_TYPE_FILTERS.some((filter) => filter.slug === slug));
}

export function readAddonTypeFromUrl(): AddonTypeSlug {
  const slug = new URLSearchParams(window.location.search).get("package");
  return isAddonTypeSlug(slug) ? slug : "all";
}

export function syncAddonTypeToUrl(slug: AddonTypeSlug, push = false): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("title");
  url.searchParams.delete("profile");
  if (slug !== "all") url.searchParams.set("package", slug);
  else url.searchParams.delete("package");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (push) window.history.pushState({ package: slug }, "", next);
  else window.history.replaceState({ package: slug }, "", next);
}

export function matchesAddonTypeFilter(download: DownloadEntry, slug: AddonTypeSlug): boolean {
  if (slug === "all") return download.type === "DLC" || download.type === "Update";
  if (slug === "dlc") return download.type === "DLC";
  return download.type === "Update";
}

export function titleHasAddonType(entry: TitleEntry, slug: AddonTypeSlug): boolean {
  return entry.downloads.some((download) => matchesAddonTypeFilter(download, slug));
}

export function countAddonDownloads(entry: TitleEntry, slug: AddonTypeSlug): number {
  return entry.downloads.filter((download) => matchesAddonTypeFilter(download, slug)).length;
}

export function addonPackageSummary(entry: TitleEntry, slug: AddonTypeSlug): string {
  const dlc = countAddonDownloads(entry, "dlc");
  const updates = countAddonDownloads(entry, "update");
  if (slug === "dlc") return dlc === 1 ? "1 pack" : `${dlc} packs`;
  if (slug === "update") return updates === 1 ? "1 update" : `${updates} updates`;
  const parts: string[] = [];
  if (dlc) parts.push(dlc === 1 ? "1 DLC" : `${dlc} DLC`);
  if (updates) parts.push(updates === 1 ? "1 update" : `${updates} updates`);
  return parts.join(" · ");
}
