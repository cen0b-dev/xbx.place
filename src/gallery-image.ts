const WESERV_ORIGIN = "https://images.weserv.nl/";

function isXboxMarketplaceImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "download.xbox.com" || host.endsWith(".download.xbox.com");
}

/** HTTPS-friendly URL for Xbox marketplace screenshots (originals are http-only, no valid TLS). */
export function galleryImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    if (!isXboxMarketplaceImageHost(parsed.hostname)) return trimmed;
    const httpUrl =
      parsed.protocol === "https:"
        ? `http://${parsed.hostname}${parsed.pathname}${parsed.search}`
        : trimmed;
    return `${WESERV_ORIGIN}?url=${encodeURIComponent(httpUrl)}`;
  } catch {
    return trimmed;
  }
}
