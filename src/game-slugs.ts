let byId: Record<string, string> = {};
let bySlug: Record<string, string> = {};

export async function loadGameSlugs(): Promise<void> {
  try {
    const res = await fetch("./game-slugs.json");
    if (!res.ok) return;
    const data = (await res.json()) as { byId?: Record<string, string>; bySlug?: Record<string, string> };
    byId = data.byId ?? {};
    bySlug = data.bySlug ?? {};
  } catch {
    /* dev without build artifacts */
  }
}

export function gameSlugForTitle(titleId: string): string {
  const upper = titleId.toUpperCase();
  return byId[upper] ?? byId[titleId] ?? titleId;
}

export function resolveTitleIdFromPath(segment: string): string | null {
  const key = decodeURIComponent(segment);
  if (bySlug[key]) return bySlug[key].toUpperCase();
  const upper = key.toUpperCase();
  if (byId[upper]) return upper;
  if (/^[A-F0-9]{8}$/i.test(key)) return upper;
  return null;
}

export function gamePagePathForTitle(titleId: string): string {
  return `/game/${encodeURIComponent(gameSlugForTitle(titleId))}/`;
}
