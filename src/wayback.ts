/** Wrap archive.org (and similar) URLs for direct file download via the Wayback Machine. */
export function waybackDownloadUrl(sourceUrl: string): string {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "web.archive.org") return trimmed;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;
    return `https://web.archive.org/web/0id_/${trimmed}`;
  } catch {
    return trimmed;
  }
}
