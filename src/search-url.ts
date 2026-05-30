export function readSearchFromUrl(): string {
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

export function syncSearchToUrl(query: string, push = false): void {
  const url = new URL(window.location.href);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (push) window.history.pushState({ q: trimmed || null }, "", next);
  else window.history.replaceState({ q: trimmed || null }, "", next);
}
