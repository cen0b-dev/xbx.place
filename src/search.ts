import Fuse from "fuse.js";
import type { TitleEntry } from "./types";

export function buildSearchIndex(data: TitleEntry[]): Fuse<TitleEntry> {
  return new Fuse(data, {
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "name", weight: 0.65 },
      { name: "developer", weight: 0.1 },
      { name: "publisher", weight: 0.1 },
      { name: "regions", weight: 0.05 },
      { name: "metadata.languageTags", weight: 0.05 },
      { name: "downloads.filename", weight: 0.05 }
    ]
  });
}

export function filterTitles(fuse: Fuse<TitleEntry>, query: string, data: TitleEntry[]): TitleEntry[] {
  const q = query.trim();
  if (!q) {
    return [...data];
  }
  return fuse.search(q).map((result) => result.item);
}
