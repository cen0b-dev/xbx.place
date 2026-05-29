import { bindCroppedCover } from "./cover-crop";
import type { DiscoverCollection } from "./collections";
import { coverUrl } from "./data";
import { profileImage } from "./profile";
import type { TitleEntry } from "./types";

export type CollectionsBrowseHandlers = {
  onOpenCollection: (collectionId: string) => void;
  onOpenProfile: (gamertag: string) => void;
};

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function descriptionExcerpt(description: string | null | undefined): string {
  const copy = description?.trim();
  if (!copy) return "No description yet.";
  if (copy.length <= 120) return copy;
  return `${copy.slice(0, 117)}…`;
}

function previewMarkup(collection: DiscoverCollection, titleIndex: Map<string, TitleEntry>): string {
  const ids = collection.preview_title_ids.slice(0, 3);
  if (!ids.length) {
    return `<div class="collections-discover-previews collections-discover-previews--empty" aria-hidden="true">
      <i class="fa-solid fa-folder-open"></i>
    </div>`;
  }

  return `<div class="collections-discover-previews collections-discover-previews--fan">${ids
    .map((titleId, index) => {
      const game = titleIndex.get(titleId);
      if (!game) {
        return `<div class="collections-discover-preview collections-discover-preview--missing" style="--preview-i:${index}"></div>`;
      }
      return `
        <div class="collections-discover-preview cover-crop-view" style="--preview-i:${index}">
          <img alt="" loading="lazy" data-cover-id="${escapeHtml(game.title_id)}" />
        </div>
      `;
    })
    .join("")}</div>`;
}

function cardMarkup(collection: DiscoverCollection, titleIndex: Map<string, TitleEntry>): string {
  const ownerPic = profileImage(
    { id: collection.user_id, gamertag: collection.owner_gamertag, gamerpic_url: collection.owner_gamerpic_url },
    null
  );
  const gameLabel = `${collection.item_count} game${collection.item_count === 1 ? "" : "s"}`;

  return `
    <button
      type="button"
      class="collections-discover-card"
      data-collection-id="${escapeHtml(collection.id)}"
      aria-label="Open ${escapeHtml(collection.name)} by ${escapeHtml(collection.owner_gamertag)}"
    >
      ${previewMarkup(collection, titleIndex)}
      <div class="collections-discover-body">
        <h3 class="collections-discover-name">${escapeHtml(collection.name)}</h3>
        <p class="collections-discover-description">${escapeHtml(descriptionExcerpt(collection.description))}</p>
        <div class="collections-discover-meta">
          <span class="collections-discover-owner" data-owner-gamertag="${escapeHtml(collection.owner_gamertag)}">
            <img class="collections-discover-owner-pic" src="${ownerPic}" alt="" />
            <span>${escapeHtml(collection.owner_gamertag)}</span>
          </span>
          <span class="collections-discover-count">${gameLabel}</span>
        </div>
      </div>
      <span class="collections-discover-open-hint">View collection <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
    </button>
  `;
}

export function renderCollectionsDiscoverGrid(
  collections: DiscoverCollection[],
  titleIndex: Map<string, TitleEntry>,
  handlers: CollectionsBrowseHandlers
): void {
  const grid = document.getElementById("collectionsDiscoverGrid");
  const count = document.getElementById("collectionsCnt");
  if (!grid) return;

  if (count) {
    count.textContent =
      collections.length === 1 ? "1 collection" : `${collections.length.toLocaleString()} collections`;
  }

  if (!collections.length) {
    grid.innerHTML = `<p class="collections-discover-empty">No public collections yet. Make a list public on your profile to share it here.</p>`;
    return;
  }

  grid.innerHTML = collections.map((collection) => cardMarkup(collection, titleIndex)).join("");

  grid.querySelectorAll<HTMLImageElement>("[data-cover-id]").forEach((img) => {
    const titleId = img.dataset.coverId;
    const game = titleId ? titleIndex.get(titleId) : undefined;
    if (game) bindCroppedCover(img, coverUrl(game));
  });

  grid.querySelectorAll<HTMLButtonElement>(".collections-discover-card").forEach((card) => {
    card.addEventListener("click", () => {
      const collectionId = card.dataset.collectionId;
      if (collectionId) handlers.onOpenCollection(collectionId);
    });
  });

  grid.querySelectorAll<HTMLElement>(".collections-discover-owner").forEach((owner) => {
    owner.addEventListener("click", (event) => {
      event.stopPropagation();
      const gamertag = owner.dataset.ownerGamertag;
      if (gamertag) handlers.onOpenProfile(gamertag);
    });
  });
}

export function setCollectionsDiscoverLoading(loading: boolean): void {
  const grid = document.getElementById("collectionsDiscoverGrid");
  const status = document.getElementById("collectionsDiscoverStatus");
  if (status) {
    status.textContent = loading ? "Loading public collections…" : "";
    status.classList.toggle("hidden", !loading);
  }
  if (!grid || !loading) return;
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="collections-discover-card is-loading skeleton"></div>').join(
    ""
  );
}

export function setCollectionsDiscoverError(message: string | null): void {
  const status = document.getElementById("collectionsDiscoverStatus");
  if (!status) return;
  status.textContent = message ?? "";
  status.classList.toggle("error", Boolean(message));
  status.classList.toggle("hidden", !message);
}
