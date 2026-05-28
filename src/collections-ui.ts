import { getCurrentUser, onAuthChange } from "./auth";
import { openAuthModal } from "./auth-ui";
import { syncGameModalBackground } from "./data";
import {
  addTitleToCollection,
  createCollection,
  loadMembershipForTitle,
  loadMyCollections,
  removeTitleFromCollection,
  type CollectionWithCount
} from "./collections";
import { checkboxHtml } from "./form-controls";
import type { TitleEntry } from "./types";

type CollectionModalView = "pick" | "create" | "empty";

let activeGame: TitleEntry | null = null;
let myCollections: CollectionWithCount[] = [];
let memberIds = new Set<string>();
let pendingMemberIds = new Set<string>();
let modalView: CollectionModalView = "empty";

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function setCollectionStatus(message: string | null, isError = false): void {
  const el = document.getElementById("collection-mod-status");
  if (!el) return;
  el.textContent = message ?? "";
  el.classList.toggle("error", isError);
  el.classList.toggle("hidden", !message);
}

function hasPendingChanges(): boolean {
  if (pendingMemberIds.size !== memberIds.size) return true;
  for (const id of pendingMemberIds) {
    if (!memberIds.has(id)) return true;
  }
  return false;
}

function syncPendingSelection(): void {
  pendingMemberIds = new Set(memberIds);
}

function updateSaveButton(): void {
  const button = document.getElementById("collection-mod-save-btn") as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !hasPendingChanges();
}

function setModalView(view: CollectionModalView): void {
  modalView = view;

  document.getElementById("collection-mod-pick-view")?.classList.toggle("hidden", view !== "pick");
  document.getElementById("collection-mod-create-view")?.classList.toggle("hidden", view !== "create");
  document.getElementById("collection-mod-empty-view")?.classList.toggle("hidden", view !== "empty");

  const title = document.getElementById("collection-mod-title");
  if (title) {
    title.textContent =
      view === "create" ? "Create new collection" : view === "empty" ? "Create your first collection" : "Add to collection";
  }

  const backLabel = document.getElementById("collection-mod-back-label");
  const backBtn = document.getElementById("close-collection-mod");
  if (view === "create" && myCollections.length > 0) {
    if (backLabel) backLabel.textContent = "Back to collections";
    backBtn?.setAttribute("aria-label", "Back to collections");
  } else {
    if (backLabel) backLabel.textContent = "Back";
    backBtn?.setAttribute("aria-label", view === "create" && myCollections.length > 0 ? "Back to collections" : "Close collections");
  }
}

function createFormHtml(containerId: string, nameId: string, publicId: string, submitId: string, submitLabel: string): string {
  return `
    <div class="collection-create-form">
      <div class="metro-field collection-field">
        <label for="${nameId}">Collection name</label>
        <input id="${nameId}" class="inp collection-inp" type="text" maxlength="64" placeholder="Favorites, Backlog, Co-op night..." autocomplete="off" />
      </div>
      <label class="collection-visibility-row">
        <span class="collection-visibility-row-copy">
          <span class="collection-visibility-row-label">Public on profile</span>
          <span class="collection-visibility-row-hint">Others can browse this list on your profile page</span>
        </span>
        ${checkboxHtml({ id: publicId })}
      </label>
      <div class="collection-create-actions">
        <button class="btn collection-create-btn" id="${submitId}" type="button" data-form-container="${containerId}">
          <i class="fa-solid fa-folder-plus" aria-hidden="true"></i><span>${submitLabel}</span>
        </button>
      </div>
    </div>
  `;
}

function bindCreateForm(submitId: string, onSubmit: () => void): void {
  document.getElementById(submitId)?.addEventListener("click", () => {
    void onSubmit();
  });
}

function renderCreateBlock(containerId: string, nameId: string, publicId: string, submitId: string, submitLabel: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = createFormHtml(containerId, nameId, publicId, submitId, submitLabel);
  bindCreateForm(submitId, () => {
    void submitCreateCollection(true, nameId, publicId);
  });
}

function renderEmptyState(): void {
  const empty = document.getElementById("collection-mod-empty");
  if (!empty) return;

  empty.innerHTML = `
    <div class="collection-mod-empty-icon" aria-hidden="true"><i class="fa-solid fa-folder-open"></i></div>
    <p class="collection-mod-empty-copy">You don't have any collections yet. Name one below to save this game.</p>
  `;

  renderCreateBlock(
    "collection-mod-create-first",
    "collection-mod-empty-name",
    "collection-mod-empty-public",
    "collection-mod-empty-create-btn",
    "Create & add game"
  );
}

function renderCollectionList(): void {
  const list = document.getElementById("collection-mod-list");
  if (!list) return;

  if (myCollections.length === 0) {
    list.innerHTML = "";
    list.classList.add("hidden");
    renderEmptyState();
    setModalView("empty");
    return;
  }
  list.classList.remove("hidden");
  list.innerHTML = myCollections
    .map((collection) => {
      const checked = pendingMemberIds.has(collection.id);
      const visibility = collection.is_public ? "Public" : "Private";
      return `
        <label class="collection-mod-row${checked ? " is-selected" : ""}">
          ${checkboxHtml({ checked, attrs: { "data-collection-id": collection.id } })}
          <span class="collection-mod-row-copy">
            <span class="collection-mod-row-name">${escapeHtml(collection.name)}</span>
            <span class="collection-mod-row-meta">
              <span class="collection-mod-badge ${collection.is_public ? "is-public" : "is-private"}">${visibility}</span>
              <span>${collection.item_count} game${collection.item_count === 1 ? "" : "s"}</span>
            </span>
          </span>
        </label>
      `;
    })
    .join("");

  list.querySelectorAll<HTMLInputElement>("input[data-collection-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const collectionId = input.dataset.collectionId;
      if (!collectionId) return;
      const row = input.closest(".collection-mod-row");
      if (input.checked) {
        pendingMemberIds.add(collectionId);
        row?.classList.add("is-selected");
      } else {
        pendingMemberIds.delete(collectionId);
        row?.classList.remove("is-selected");
      }
      updateSaveButton();
      setCollectionStatus(null);
    });
  });

  renderCreateBlock(
    "collection-mod-create",
    "collection-mod-name",
    "collection-mod-public",
    "collection-mod-create-btn",
    "Create & add game"
  );

  updateSaveButton();
}

async function submitCreateCollection(
  addGame: boolean,
  nameId = "collection-mod-name",
  publicId = "collection-mod-public"
): Promise<void> {
  const user = getCurrentUser();
  if (!user || !activeGame) return;

  const nameInput = document.getElementById(nameId) as HTMLInputElement | null;
  const publicInput = document.getElementById(publicId) as HTMLInputElement | null;
  const name = nameInput?.value.trim() ?? "";
  if (!name) {
    setCollectionStatus("Enter a collection name.", true);
    nameInput?.focus();
    return;
  }

  setCollectionStatus("Creating collection...");
  try {
    const collection = await createCollection(user, {
      name,
      is_public: publicInput?.checked ?? false
    });
    myCollections = [{ ...collection, item_count: 0 }, ...myCollections];
    if (addGame) {
      await addTitleToCollection(collection.id, activeGame.title_id);
      memberIds.add(collection.id);
      myCollections = myCollections.map((row) =>
        row.id === collection.id ? { ...row, item_count: row.item_count + 1 } : row
      );
    }
    syncPendingSelection();
    setCollectionStatus(addGame ? `Added to "${collection.name}".` : `Created "${collection.name}".`);
    window.dispatchEvent(new CustomEvent("xbx-collections-changed"));
    setModalView("pick");
    renderCollectionList();
  } catch (error) {
    setCollectionStatus(error instanceof Error ? error.message : "Could not create collection.", true);
  }
}

async function submitCollectionChanges(): Promise<void> {
  const user = getCurrentUser();
  if (!user || !activeGame || !hasPendingChanges()) return;

  const toAdd = [...pendingMemberIds].filter((id) => !memberIds.has(id));
  const toRemove = [...memberIds].filter((id) => !pendingMemberIds.has(id));
  const button = document.getElementById("collection-mod-save-btn") as HTMLButtonElement | null;
  if (button) button.disabled = true;

  setCollectionStatus("Saving changes...");
  try {
    for (const collectionId of toAdd) {
      await addTitleToCollection(collectionId, activeGame.title_id);
      memberIds.add(collectionId);
      myCollections = myCollections.map((row) =>
        row.id === collectionId ? { ...row, item_count: row.item_count + 1 } : row
      );
    }
    for (const collectionId of toRemove) {
      await removeTitleFromCollection(collectionId, activeGame.title_id);
      memberIds.delete(collectionId);
      myCollections = myCollections.map((row) =>
        row.id === collectionId ? { ...row, item_count: Math.max(0, row.item_count - 1) } : row
      );
    }

    syncPendingSelection();
    updateSaveButton();
    renderCollectionList();

    const addedNames = toAdd
      .map((id) => myCollections.find((row) => row.id === id)?.name)
      .filter(Boolean) as string[];
    if (addedNames.length === 1 && toRemove.length === 0) {
      setCollectionStatus(`Added to "${addedNames[0]}".`);
    } else if (toRemove.length === 1 && toAdd.length === 0) {
      setCollectionStatus("Removed from collection.");
    } else {
      setCollectionStatus("Collection changes saved.");
    }
    window.dispatchEvent(new CustomEvent("xbx-collections-changed"));
  } catch (error) {
    setCollectionStatus(error instanceof Error ? error.message : "Could not update collections.", true);
    updateSaveButton();
  }
}

async function refreshModalData(): Promise<void> {
  const user = getCurrentUser();
  if (!user || !activeGame) return;

  myCollections = await loadMyCollections(user);
  memberIds = await loadMembershipForTitle(user, activeGame.title_id);
  syncPendingSelection();
  renderCollectionList();
  if (myCollections.length > 0 && modalView === "empty") {
    setModalView("pick");
  }
}

export function closeCollectionModal(): void {
  document.getElementById("collectionMod")?.classList.remove("show");
  modalView = "empty";
  setCollectionStatus(null);
}

export async function openCollectionModal(game: TitleEntry): Promise<void> {
  const user = getCurrentUser();
  if (!user) {
    openAuthModal("Sign in to save games to a collection.");
    return;
  }

  activeGame = game;
  modalView = "empty";
  setCollectionStatus(null);

  const subtitle = document.getElementById("collection-mod-subtitle");
  if (subtitle) subtitle.textContent = game.name;

  syncGameModalBackground("collectionMod", game);
  document.getElementById("collectionMod")?.classList.add("show");
  await refreshModalData();
}

export function syncGameCollectionButton(): void {
  const user = getCurrentUser();
  const tooltip = user ? "Add this game to your collections" : "Sign in to save games to a collection";
  document.getElementById("gp-collection-btn")?.setAttribute("title", tooltip);
  document.getElementById("gp-collection-save-btn")?.setAttribute("title", tooltip);
}

export function bindCollectionUi(): void {
  const openForActiveGame = (): void => {
    if (!activeGame) return;
    void openCollectionModal(activeGame);
  };

  document.getElementById("gp-collection-btn")?.addEventListener("click", openForActiveGame);
  document.getElementById("gp-collection-save-btn")?.addEventListener("click", openForActiveGame);

  document.getElementById("close-collection-mod")?.addEventListener("click", () => {
    if (modalView === "create" && myCollections.length > 0) {
      setCollectionStatus(null);
      setModalView("pick");
      updateSaveButton();
      return;
    }
    closeCollectionModal();
  });
  document.getElementById("collectionMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCollectionModal();
  });

  document.getElementById("collection-mod-new-btn")?.addEventListener("click", () => {
    setCollectionStatus(null);
    renderCreateBlock(
      "collection-mod-create",
      "collection-mod-name",
      "collection-mod-public",
      "collection-mod-create-btn",
      "Create & add game"
    );
    setModalView("create");
    const nameInput = document.getElementById("collection-mod-name") as HTMLInputElement | null;
    nameInput?.focus();
  });

  document.getElementById("collection-mod-save-btn")?.addEventListener("click", () => {
    void submitCollectionChanges();
  });

  syncGameCollectionButton();
  onAuthChange(() => syncGameCollectionButton());
}

export function setActiveGameForCollections(game: TitleEntry | null): void {
  activeGame = game;
}
