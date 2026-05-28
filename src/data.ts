import type { TitleEntry } from "./types";
function normalizeTitleEntry(row: TitleEntry): TitleEntry {
  const downloads = (row.downloads ?? [])
    .filter((download) => Boolean(download?.url) && Boolean(download?.filename))
    .map((download) => ({
      ...download,
      type: download.type ?? "ROM",
      label: download.label ?? download.filename.replace(/\.(zip|iso)$/i, "")
    }));

  return {
    ...row,
    downloads
  };
}

export async function loadTitles(): Promise<TitleEntry[]> {
  const response = await fetch("./master_index.json");
  if (!response.ok) {
    throw new Error(`Failed loading titles: ${response.status}`);
  }
  const rows = (await response.json()) as TitleEntry[];
  const normalized = rows.map(normalizeTitleEntry);
  const deduped = new Map<string, TitleEntry>();
  for (const row of normalized) {
    const key = row.name.trim().toLowerCase();
    const existing = deduped.get(key);
    const rowScore = (row.rating ?? 0) + (row.developer ? 0.5 : 0);
    const existingScore = (existing?.rating ?? 0) + (existing?.developer ? 0.5 : 0);
    if (!existing || rowScore > existingScore) {
      deduped.set(key, row);
    }
  }
  return Array.from(deduped.values());
}

export function coverUrl(titleId: string): string {
  if (!/^[A-F0-9]{8}$/i.test(titleId)) {
    return "https://placehold.co/280x390/1a1a1a/ffffff?text=No+Cover";
  }
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${titleId}/artwork/boxart.jpg`;
}

export function bgUrl(titleId: string): string {
  if (!/^[A-F0-9]{8}$/i.test(titleId)) {
    return "";
  }
  return `https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles/${titleId}/artwork/background.jpg`;
}

export function syncGameModalBackground(modalRootId: string, game: TitleEntry | null): void {
  const root = document.getElementById(modalRootId);
  const panel = root?.querySelector(".game-modal");
  const img = root?.querySelector(".game-modal-bg-img") as HTMLImageElement | null;
  if (!panel) return;

  const background = game?.title_id ? bgUrl(game.title_id) : "";
  if (background) {
    panel.classList.remove("game-modal--ambient");
    if (img) {
      img.src = background;
      img.alt = "";
    }
  } else {
    panel.classList.add("game-modal--ambient");
    if (img) {
      img.removeAttribute("src");
      img.alt = "";
    }
  }
}
