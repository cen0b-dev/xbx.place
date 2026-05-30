export function isGameEntry(entry) {
  return (
    entry.downloads.length === 0 ||
    entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM")
  );
}

export function gameScore(entry) {
  const rating = entry.rating ?? 0;
  const files = entry.downloads?.length ?? 0;
  return rating * 1000 + Math.min(files, 99);
}

export function topGames(titles, slugById, limit = 100) {
  return titles
    .filter(isGameEntry)
    .filter((entry) => slugById[String(entry.title_id).toUpperCase()])
    .sort((a, b) => gameScore(b) - gameScore(a))
    .slice(0, limit)
    .map((entry, index) => {
      const titleId = String(entry.title_id).toUpperCase();
      const slug = slugById[titleId];
      return {
        position: index + 1,
        titleId,
        slug,
        name: entry.name,
        rating: entry.rating ?? null,
        path: `/game/${encodeURIComponent(slug)}/`,
        url: `https://xbx.place/game/${encodeURIComponent(slug)}/`,
      };
    });
}
