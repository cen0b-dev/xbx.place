import type { DownloadEntry } from "./types";

const VERSION_RE = /\(v(\d+(?:\.\d+)?)(?:\s+\d+)?([a-z])?\)/i;

function parseUpdateVersion(raw: string): number {
  const match = raw.match(VERSION_RE);
  if (!match?.[1]) return 0;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return 0;
  const letter = match[2] ? (match[2].toLowerCase().charCodeAt(0) - 96) * 0.001 : 0;
  return base + letter;
}

export function formatUpdateVersion(raw: string): string | null {
  const match = raw.match(VERSION_RE);
  if (!match?.[1]) return null;
  return `v${match[1]}${match[2] ?? ""}`;
}

function sortTitleUpdates(downloads: DownloadEntry[]): DownloadEntry[] {
  return [...downloads].sort((a, b) => {
    const av = a.updateVersion ?? parseUpdateVersion(a.label ?? a.filename);
    const bv = b.updateVersion ?? parseUpdateVersion(b.label ?? b.filename);
    if (bv !== av) return bv - av;
    return (a.label ?? a.filename).localeCompare(b.label ?? b.filename);
  });
}

export function orderPackageDownloads(downloads: DownloadEntry[], includeUpdates: boolean): DownloadEntry[] {
  if (!includeUpdates) return downloads;
  const updates = sortTitleUpdates(downloads.filter((dl) => dl.type === "Update"));
  const rest = downloads.filter((dl) => dl.type !== "Update");
  return [...updates, ...rest];
}
