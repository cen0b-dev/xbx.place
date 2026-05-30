export function slugify(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildSlugMap(titles) {
  const used = new Map();
  const byId = {};

  for (const title of titles) {
    const titleId = String(title.title_id).toUpperCase();
    let base = slugify(title.name);
    if (!base) base = titleId.toLowerCase();
    let slug = base;
    let suffix = 2;
    while (used.has(slug) && used.get(slug) !== titleId) {
      slug = `${base}-${suffix++}`;
    }
    used.set(slug, titleId);
    byId[titleId] = slug;
  }

  const bySlug = Object.fromEntries(Object.entries(byId).map(([id, slug]) => [slug, id]));
  return { byId, bySlug };
}

export function gamePath(slug) {
  return `/game/${encodeURIComponent(slug)}/`;
}
