import type { User } from "@supabase/supabase-js";
import {
  authAvailable,
  onAuthChange,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  type AuthMode
} from "./auth";
import { applyRobotsMeta } from "./seo-url";
import {
  COLLECTION_DESCRIPTION_MAX_LEN,
  deleteCollection,
  loadCollectionItems,
  loadCollectionPreviewIds,
  loadMyCollections,
  loadPublicCollections,
  removeTitleFromCollection,
  updateCollection,
  type CollectionWithCount
} from "./collections";
import { bindCroppedCover } from "./cover-crop";
import { coverUrl, loadTitles } from "./data";
import { DISCORD_INVITE_URL } from "./discord";
import { checkboxHtml } from "./form-controls";
import {
  fallbackGamerpic,
  loadProfile,
  loadPublicProfileByGamertag,
  profileBannerImage,
  profileImage,
  profileName,
  saveProfile,
  type Profile,
  type ProfileInput,
  type PublicProfile
} from "./profile";
import { profileImageUploadHint, uploadProfileImage, type ProfileImageKind } from "./profile-upload";
import { escapeAttr, sanitizeCollectionName, sanitizeGamertag } from "./sanitize";
import type { TitleEntry } from "./types";

let authMode: AuthMode = "sign-in";
let activeUser: User | null = null;
let activeProfile: Profile | null = null;
let viewedProfile: Profile | PublicProfile | null = null;
let profileViewOwner = true;
let profileCollections: CollectionWithCount[] = [];
let editingCollectionId: string | null = null;
let titleIndexPromise: Promise<Map<string, TitleEntry>> | null = null;

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatMemberSince(iso: string | undefined): string {
  if (!iso) return "Recently joined";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recently joined";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function setAuthMode(mode: AuthMode): void {
  authMode = mode;
  document.querySelectorAll<HTMLElement>("[data-auth-mode]").forEach((node) => {
    const active = node.dataset.authMode === mode;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
  });

  const title = document.getElementById("auth-title");
  const subtitle = document.getElementById("auth-subtitle");
  const submit = document.getElementById("auth-submit");
  const password = document.getElementById("auth-password") as HTMLInputElement | null;

  if (title) {
    title.textContent = mode === "sign-in" ? "Sign In" : "Create Account";
  }
  if (subtitle) {
    subtitle.textContent =
      mode === "sign-in"
        ? "Sign in to save your gamertag, gamerpic, and collections."
        : "Join free — gamertag, gamerpic, profile, and game collections.";
  }
  if (submit) {
    submit.textContent = mode === "sign-in" ? "Sign In" : "Create Account";
  }
  if (password) {
    password.autocomplete = mode === "sign-in" ? "current-password" : "new-password";
  }
}

function setAuthError(message: string | null): void {
  const el = document.getElementById("auth-error");
  if (!el) return;
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function setAuthBusy(busy: boolean): void {
  const submit = document.getElementById("auth-submit") as HTMLButtonElement | null;
  const email = document.getElementById("auth-email") as HTMLInputElement | null;
  const password = document.getElementById("auth-password") as HTMLInputElement | null;
  if (submit) submit.disabled = busy;
  if (email) email.disabled = busy;
  if (password) password.disabled = busy;
}

export function openAuthModal(reason?: string, mode: AuthMode = "sign-in"): void {
  const body = document.getElementById("auth-body");
  if (body) {
    const copy = reason?.trim();
    if (copy) {
      body.textContent = copy;
      body.classList.remove("hidden");
    } else {
      body.textContent = "";
      body.classList.add("hidden");
    }
  }
  setAuthError(null);
  setAuthMode(mode);
  document.getElementById("authMod")?.classList.add("show");
  window.setTimeout(() => {
    document.getElementById("auth-email")?.focus();
  }, 80);
}

export function closeAuthModal(): void {
  document.getElementById("authMod")?.classList.remove("show");
  setAuthError(null);
}

function closeAccountMenu(): void {
  document.getElementById("account-menu")?.classList.add("hidden");
  const btn = document.getElementById("auth-control");
  btn?.setAttribute("aria-expanded", "false");
  btn?.classList.remove("is-open");
}

function openAccountMenu(): void {
  const menu = document.getElementById("account-menu");
  const btn = document.getElementById("auth-control");
  if (!menu || !btn) return;
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
  btn.classList.add("is-open");
}

function toggleAccountMenu(): void {
  const menu = document.getElementById("account-menu");
  if (menu?.classList.contains("hidden")) openAccountMenu();
  else closeAccountMenu();
}

function profileFormValues(): ProfileInput {
  return {
    gamertag: (document.getElementById("profile-gamertag") as HTMLInputElement | null)?.value ?? "",
    gamerpic_url: activeProfile?.gamerpic_url ?? null,
    banner_url: activeProfile?.banner_url ?? null,
    bio: (document.getElementById("profile-bio") as HTMLTextAreaElement | null)?.value || null
  };
}

function fillProfileForm(): void {
  const name = profileName(activeProfile, activeUser);
  const image = profileImage(activeProfile, activeUser);
  const banner = profileBannerImage(activeProfile, activeUser?.id);
  const bio = activeProfile?.bio || "";
  const email = activeUser?.email ?? "";
  const handle = `@${sanitizeGamertag(name).replace(/\s+/g, "").toLowerCase()}`;
  const memberSince = formatMemberSince(activeProfile?.created_at);
  const gamerpicPreview = document.getElementById("profile-pic-preview") as HTMLImageElement | null;
  setText("profile-display-name", name);
  setText("profile-display-email", email);
  setText("profile-view-name", name);
  setText("profile-view-bio", bio || "Add a bio from profile settings.");
  setText("profile-view-handle", handle);
  setText("profile-view-email-tile", email || "—");
  setText("profile-view-member-tile", memberSince);
  setText("account-menu-name", name);
  setText("account-menu-handle", handle);

  const gamertag = document.getElementById("profile-gamertag") as HTMLInputElement | null;
  const bioInput = document.getElementById("profile-bio") as HTMLTextAreaElement | null;
  if (gamertag) gamertag.value = name;
  if (bioInput) bioInput.value = bio;
  if (gamerpicPreview) gamerpicPreview.src = image;
  setProfileBannerPreview(activeProfile, activeUser?.id);
  document.querySelectorAll<HTMLImageElement>("[data-profile-avatar]").forEach((img) => {
    img.src = image;
  });
  updateProfileOwnerControls(true);
}

async function getTitleIndex(): Promise<Map<string, TitleEntry>> {
  if (!titleIndexPromise) {
    titleIndexPromise = loadTitles().then((rows) => new Map(rows.map((row) => [row.title_id, row])));
  }
  return titleIndexPromise;
}

function profileHandleFromName(name: string): string {
  return `@${name.replace(/\s+/g, "").toLowerCase()}`;
}

function setProfileBannerPreview(profile: Profile | PublicProfile | null, userId?: string): void {
  const bannerPreview = document.getElementById("profile-banner-preview");
  if (!bannerPreview) return;
  const url = profile ? profileBannerImage(profile, userId ?? profile.id) : null;
  bannerPreview.classList.toggle("profile-page-bg--custom", Boolean(url));
  bannerPreview.classList.toggle("profile-page-bg--fallback", !url);
  if (url) {
    bannerPreview.style.backgroundImage = `url("${url}")`;
  } else {
    bannerPreview.style.backgroundImage = "";
  }
}

function collectionDescriptionExcerpt(description: string | null | undefined): string {
  const copy = description?.trim();
  if (!copy) return "No description yet.";
  if (copy.length <= 120) return copy;
  return `${copy.slice(0, 117)}…`;
}

function profileCollectionPreviewMarkup(
  previewIds: string[],
  titleIndex: Map<string, TitleEntry>
): string {
  const ids = previewIds.slice(0, 3);
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

function publicProfileRouteUrl(gamertag: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("title");
  url.searchParams.set("profile", gamertag.trim());
  return `${url.pathname}${url.search}${url.hash}`;
}

function updateProfileOwnerControls(isOwner: boolean): void {
  document.getElementById("profile-edit")?.classList.toggle("hidden", !isOwner);
  document.getElementById("profile-copy-link")?.classList.toggle("hidden", !isOwner);
  document.getElementById("profile-account-section")?.classList.toggle("hidden", !isOwner);
}

function showProfileNotFound(show: boolean): void {
  document.getElementById("profile-not-found")?.classList.toggle("hidden", !show);
  document.getElementById("profile-view-content")?.classList.toggle("hidden", show);
  document.getElementById("profile-collections-section")?.classList.toggle("hidden", show);
}

function fillPublicProfileView(profile: PublicProfile): void {
  const name = profile.gamertag.trim() || "Player";
  const image = profileImage(profile, null);
  const bio = profile.bio || "";
  const handle = profileHandleFromName(name);
  const memberSince = formatMemberSince(profile.created_at);

  setText("profile-view-name", name);
  setText("profile-view-bio", bio || "No bio yet.");
  setText("profile-view-handle", handle);
  setText("profile-view-member-tile", memberSince);
  setProfileBannerPreview(profile);
  document.querySelectorAll<HTMLImageElement>("[data-profile-avatar]").forEach((img) => {
    img.src = image;
  });
  updateProfileOwnerControls(false);
  showProfileNotFound(false);
}

function closeCollectionEditModal(): void {
  document.getElementById("profileCollectionEditMod")?.classList.remove("show");
  editingCollectionId = null;
}

function setCollectionSettingsStatus(message: string, isError = false): void {
  const status = document.getElementById("profile-collection-edit-status");
  if (!status) return;
  status.textContent = message;
  status.className = `profile-collection-settings-status${isError ? " error" : ""}`;
  status.classList.remove("hidden");
}

function fillCollectionEditForm(collection: CollectionWithCount): void {
  const title = document.getElementById("profile-collection-edit-title");
  const nameInput = document.getElementById("profile-collection-edit-name") as HTMLInputElement | null;
  const descriptionInput = document.getElementById(
    "profile-collection-edit-description"
  ) as HTMLTextAreaElement | null;
  const publicInput = document.getElementById("profile-collection-edit-public") as HTMLInputElement | null;
  const status = document.getElementById("profile-collection-edit-status");

  if (title) title.textContent = collection.name;
  if (nameInput) nameInput.value = collection.name;
  if (descriptionInput) descriptionInput.value = collection.description ?? "";
  if (publicInput) publicInput.checked = collection.is_public;
  status?.classList.add("hidden");
  const deleteBtn = document.getElementById("profile-collection-edit-delete");
  deleteBtn?.setAttribute("data-collection-id", collection.id);
}

async function renderCollectionManageGames(collectionId: string): Promise<void> {
  const container = document.getElementById("profile-collection-manage-games");
  if (!container) return;

  const titleIds = await loadCollectionItems(collectionId);
  const index = await getTitleIndex();

  if (!titleIds.length) {
    container.innerHTML = `<p class="profile-collections-empty">No games in this collection yet. Add games from a title page.</p>`;
    return;
  }

  container.innerHTML = `<ul class="profile-collection-manage-list">${titleIds
    .map((titleId) => {
      const game = index.get(titleId);
      const name = game?.name ?? titleId;
      return `
        <li class="profile-collection-manage-row">
          <button type="button" class="profile-collection-manage-open" data-action="open-game" data-collection-id="${collectionId}" data-title-id="${escapeHtml(titleId)}">
            ${escapeHtml(name)}
          </button>
          <button type="button" class="profile-collection-manage-remove" data-action="remove-game" data-collection-id="${collectionId}" data-title-id="${escapeHtml(titleId)}" aria-label="Remove ${escapeHtml(name)}">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </li>
      `;
    })
    .join("")}</ul>`;

  container.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleProfileCollectionAction(button);
    });
  });
}

async function openCollectionSettings(collectionId: string): Promise<void> {
  const collection = profileCollections.find((row) => row.id === collectionId);
  if (!collection) return;

  editingCollectionId = collectionId;
  fillCollectionEditForm(collection);
  await renderCollectionManageGames(collectionId);
  document.getElementById("profileCollectionEditMod")?.classList.add("show");
}

async function submitCollectionSettings(): Promise<void> {
  const collectionId = editingCollectionId;
  const collection = collectionId ? profileCollections.find((row) => row.id === collectionId) : undefined;
  if (!collection || !activeUser || !collectionId) return;

  const nameInput = document.getElementById("profile-collection-edit-name") as HTMLInputElement | null;
  const descriptionInput = document.getElementById(
    "profile-collection-edit-description"
  ) as HTMLTextAreaElement | null;
  const publicInput = document.getElementById("profile-collection-edit-public") as HTMLInputElement | null;
  const saveBtn = document.getElementById("profile-collection-edit-save") as HTMLButtonElement | null;

  const name = sanitizeCollectionName(nameInput?.value ?? "");
  if (!name) {
    setCollectionSettingsStatus("Enter a collection name.", true);
    nameInput?.focus();
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    await updateCollection(collectionId, {
      name,
      description: descriptionInput?.value ?? null,
      is_public: publicInput?.checked ?? false
    });
    await refreshProfileCollections();
    const updated = profileCollections.find((row) => row.id === collectionId);
    if (updated) fillCollectionEditForm(updated);
    await renderCollectionManageGames(collectionId);
    setCollectionSettingsStatus("Collection updated.");
  } catch (error) {
    setCollectionSettingsStatus(error instanceof Error ? error.message : "Could not update collection.", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function removeGameFromCollection(collectionId: string, titleId: string): Promise<void> {
  const index = await getTitleIndex();
  const game = index.get(titleId);
  const label = game?.name ?? "this game";
  if (!window.confirm(`Remove "${label}" from this collection?`)) return;

  try {
    await removeTitleFromCollection(collectionId, titleId);
    await refreshProfileCollections();
    if (editingCollectionId === collectionId) {
      await openCollectionSettings(collectionId);
    }
  } catch (error) {
    setCollectionSettingsStatus(error instanceof Error ? error.message : "Could not remove game.", true);
  }
}

async function renderProfileCollectionCards(
  isOwner: boolean,
  previews: Map<string, string[]>
): Promise<void> {
  const grid = document.getElementById("profile-collections-grid");
  if (!grid) return;

  if (!profileCollections.length) {
    grid.innerHTML = `<p class="profile-collections-empty">${isOwner ? "Save games to a collection from any game page." : "No public collections yet."}</p>`;
    return;
  }

  const titleIndex = await getTitleIndex();
  const countLabel = profileCollections.length === 1 ? "1 collection" : `${profileCollections.length} collections`;
  const countEl = document.getElementById("profile-collections-count");
  if (countEl) countEl.textContent = countLabel;

  grid.innerHTML = profileCollections
    .map((collection) => {
      const visibility = collection.is_public ? "Public" : "Private";
      const previewIds = previews.get(collection.id) ?? [];
      const gameLabel = `${collection.item_count} game${collection.item_count === 1 ? "" : "s"}`;
      const mainAction = collection.is_public ? "open" : "none";
      const editBtn = isOwner
        ? `<button type="button" class="profile-collection-edit-btn" data-action="edit" data-collection-id="${collection.id}" aria-label="Edit ${escapeHtml(collection.name)}">
            <i class="fa-solid fa-pen" aria-hidden="true"></i><span>Edit</span>
          </button>`
        : "";

      return `
        <article class="profile-collection-card${isOwner ? " profile-collection-card--owner" : ""}" data-collection-id="${collection.id}">
          <div class="profile-collection-card-wrap">
            <button
              type="button"
              class="profile-collection-card-main${collection.is_public ? "" : " profile-collection-card-main--private"}"
              data-action="${mainAction}"
              data-collection-id="${collection.id}"
              aria-label="${collection.is_public ? `Open ${escapeHtml(collection.name)}` : escapeHtml(collection.name)}"
            >
              ${profileCollectionPreviewMarkup(previewIds, titleIndex)}
              <div class="collections-discover-body">
                <h3 class="collections-discover-name">${escapeHtml(collection.name)}</h3>
                <p class="collections-discover-description">${escapeHtml(collectionDescriptionExcerpt(collection.description))}</p>
                <div class="collections-discover-meta">
                  <span class="profile-collection-badge ${collection.is_public ? "is-public" : "is-private"}">${visibility}</span>
                  <span class="collections-discover-count">${gameLabel}</span>
                </div>
              </div>
              ${collection.is_public ? `<span class="collections-discover-open-hint">View collection <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>` : ""}
            </button>
            ${editBtn}
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll<HTMLImageElement>("[data-cover-id]").forEach((img) => {
    const titleId = img.dataset.coverId;
    const game = titleId ? titleIndex.get(titleId) : undefined;
    if (game) bindCroppedCover(img, coverUrl(game));
  });

  grid.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleProfileCollectionAction(button);
    });
  });

  if (editingCollectionId && profileCollections.some((row) => row.id === editingCollectionId)) {
    await openCollectionSettings(editingCollectionId);
  } else {
    editingCollectionId = null;
  }
}

async function handleProfileCollectionAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.action;
  const collectionId = button.dataset.collectionId;
  const titleId = button.dataset.titleId;
  if (!action || !collectionId) return;

  if (action === "open") {
    window.dispatchEvent(new CustomEvent("xbx-open-collection", { detail: { collectionId } }));
    return;
  }

  if (action === "none") {
    return;
  }

  if (action === "edit") {
    await openCollectionSettings(collectionId);
    return;
  }

  if (action === "save-settings") {
    await submitCollectionSettings();
    return;
  }

  if (action === "remove-game") {
    if (!titleId || !profileViewOwner) return;
    await removeGameFromCollection(collectionId, titleId);
    return;
  }

  if (action === "open-game") {
    if (!titleId) return;
    closeCollectionEditModal();
    window.dispatchEvent(new CustomEvent("xbx-open-game", { detail: { titleId } }));
    return;
  }

  if (!profileViewOwner || !activeUser) return;

  if (action === "delete") {
    const collection = profileCollections.find((row) => row.id === collectionId);
    if (!collection) return;
    if (!window.confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      closeCollectionEditModal();
      await deleteCollection(collectionId);
      await refreshProfileCollections();
    } catch (error) {
      console.warn(error);
    } finally {
      button.disabled = false;
    }
  }
}

async function refreshProfileCollections(): Promise<void> {
  if (!viewedProfile) return;
  profileCollections = profileViewOwner
    ? activeUser
      ? await loadMyCollections(activeUser)
      : []
    : await loadPublicCollections(viewedProfile.id);
  const previews = profileCollections.length
    ? await loadCollectionPreviewIds(profileCollections.map((row) => row.id))
    : new Map();
  await renderProfileCollectionCards(profileViewOwner, previews);
}

async function copyProfileLink(): Promise<void> {
  const gamertag = activeProfile?.gamertag?.trim();
  if (!gamertag) return;
  const url = new URL(publicProfileRouteUrl(gamertag), window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
    const status = document.getElementById("profile-copy-status");
    if (status) {
      status.textContent = "Profile link copied.";
      status.classList.remove("hidden");
      window.setTimeout(() => status.classList.add("hidden"), 2000);
    }
  } catch {
    window.prompt("Copy profile link:", url);
  }
}

function homeRouteUrl(): string {
  return window.location.pathname;
}

function setProfileStatus(message: string | null, isError = false): void {
  const status = document.getElementById("profile-status");
  if (!status) return;
  status.textContent = message ?? "";
  status.classList.toggle("error", isError);
  status.classList.toggle("hidden", !message);
}

export function syncHeaderAccountPlacement(): void {
  const btn = document.getElementById("auth-control");
  const menu = document.getElementById("account-menu");
  const browse = document.getElementById("header-account-browse");
  const fallback = document.getElementById("header-account-fallback");
  if (!btn) return;
  const slot =
    document.body.classList.contains("game-view") ||
    document.body.classList.contains("profile-view") ||
    document.body.classList.contains("collection-view")
      ? fallback
      : browse;
  if (!slot) return;
  if (btn.parentElement !== slot) slot.appendChild(btn);
  if (menu && menu.parentElement !== slot) slot.appendChild(menu);
}

export function updateAuthControl(user: User | null): void {
  const btn = document.getElementById("auth-control") as HTMLButtonElement | null;
  if (!btn) return;

  if (!authAvailable()) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "";
  btn.title = user ? "Open account menu" : "Sign in or create an account";
  btn.setAttribute("aria-haspopup", user ? "menu" : "dialog");
  btn.setAttribute("aria-expanded", "false");

  if (user) {
    btn.className = "account-trigger account-trigger--signed";
    btn.innerHTML = `<img class="account-trigger-pic" data-profile-avatar src="${escapeAttr(
      profileImage(activeProfile, user)
    )}" alt="" />`;
  } else {
    btn.className = "account-trigger account-trigger--guest";
    btn.innerHTML = `<span class="account-trigger-icon" aria-hidden="true"><i class="fa-solid fa-user"></i></span><span class="account-trigger-label">Sign In</span>`;
  }

  renderAccountMenu();
  fillProfileForm();
  syncHeaderAccountPlacement();
}

function renderAccountMenu(): void {
  const menu = document.getElementById("account-menu");
  if (!menu) return;
  if (!activeUser) {
    menu.innerHTML = "";
    menu.classList.add("hidden");
    return;
  }

  const name = escapeHtml(profileName(activeProfile, activeUser));
  const email = escapeHtml(activeUser.email ?? "");
  const image = escapeAttr(profileImage(activeProfile, activeUser));

  menu.innerHTML = `
    <div class="browse-filter-drawer-head">
      <h3 class="browse-filter-drawer-title">Account</h3>
      <button type="button" class="browse-filter-drawer-close" id="account-menu-close" aria-label="Close account menu">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
    <div class="browse-filter-drawer-body">
      <div class="account-menu-profile">
        <img class="account-menu-avatar" data-profile-avatar src="${image}" alt="" />
        <div class="account-menu-identity-text">
          <div class="account-menu-name" id="account-menu-name">${name}</div>
          <div class="account-menu-handle" id="account-menu-handle">@player</div>
          <div class="account-menu-email">${email}</div>
        </div>
      </div>
      <div class="browse-filter-drawer-field">
        <span class="browse-toolbar-label">Quick links</span>
        <div class="account-menu-actions">
          <button type="button" class="account-menu-action" id="open-profile-page">
            <i class="fa-solid fa-id-card" aria-hidden="true"></i><span>Profile</span>
          </button>
          <button type="button" class="account-menu-action" id="open-account-settings">
            <i class="fa-solid fa-user-gear" aria-hidden="true"></i><span>Account settings</span>
          </button>
          <button type="button" class="account-menu-action" id="open-app-settings">
            <i class="fa-solid fa-sliders" aria-hidden="true"></i><span>Preferences</span>
          </button>
          <a class="account-menu-action account-menu-action--link" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer">
            <i class="fa-brands fa-discord" aria-hidden="true"></i><span>Join Discord</span>
          </a>
        </div>
      </div>
    </div>
    <div class="browse-filter-drawer-foot">
      <button type="button" class="browse-filter-drawer-reset account-menu-signout" id="account-sign-out">
        <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>Sign out</span>
      </button>
    </div>
  `;

  fillProfileForm();

  document.getElementById("account-menu-close")?.addEventListener("click", () => closeAccountMenu());
  document.getElementById("open-profile-page")?.addEventListener("click", () => {
    closeAccountMenu();
    openProfilePage();
  });
  document.getElementById("open-account-settings")?.addEventListener("click", () => {
    closeAccountMenu();
    openAccountSettings();
  });
  document.getElementById("open-app-settings")?.addEventListener("click", () => {
    closeAccountMenu();
    document.getElementById("setMod")?.classList.add("show");
  });
  document.getElementById("account-sign-out")?.addEventListener("click", async () => {
    closeAccountMenu();
    await signOut();
  });
}

export function openProfilePage(push = true): void {
  if (!activeUser) {
    openAuthModal("Create an account or sign in to view your profile.");
    return;
  }
  viewedProfile = activeProfile;
  profileViewOwner = true;
  fillProfileForm();
  showProfilePageShell(push, "me");
  void refreshProfileCollections();
}

export async function openPublicProfileByGamertag(gamertag: string, push = true): Promise<void> {
  if (gamertag.trim().toLowerCase() === "me") {
    openProfilePage(push);
    return;
  }

  try {
    const profile = await loadPublicProfileByGamertag(gamertag);
    if (!profile) {
      viewedProfile = null;
      profileViewOwner = false;
      showProfilePageShell(push, gamertag);
      showProfileNotFound(true);
      profileCollections = [];
      await renderProfileCollectionCards(false, new Map());
      return;
    }

    viewedProfile = profile;
    profileViewOwner = activeUser?.id === profile.id;
    if (profileViewOwner) {
      fillProfileForm();
    } else {
      fillPublicProfileView(profile);
    }
    showProfilePageShell(push, profile.gamertag);
    await refreshProfileCollections();
  } catch (error) {
    console.warn("Unable to load profile", error);
    showProfileNotFound(true);
  }
}

function showProfilePageShell(push: boolean, profileParam: string): void {
  document.body.classList.remove("game-view");
  document.getElementById("gamePage")?.classList.add("hidden");
  document.getElementById("gamePage")?.setAttribute("aria-hidden", "true");
  document.getElementById("downloadMod")?.classList.remove("show");
  document.getElementById("packageMod")?.classList.remove("show");
  document.body.classList.add("profile-view");
  syncHeaderAccountPlacement();
  document.getElementById("profilePage")?.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (push) {
    const url = new URL(window.location.href);
    url.searchParams.delete("title");
    url.searchParams.set("profile", profileParam);
    window.history.pushState({ profile: profileParam }, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

export async function syncProfileRouteFromUrl(): Promise<void> {
  const param = new URLSearchParams(window.location.search).get("profile");
  if (!param) {
    closeProfilePage(false);
    return;
  }
  if (param === "me") {
    if (activeUser) openProfilePage(false);
    else closeProfilePage(false);
    applyRobotsMeta();
    return;
  }
  await openPublicProfileByGamertag(param, false);
  applyRobotsMeta();
}

export function closeProfilePage(push = true): void {
  document.body.classList.remove("profile-view");
  syncHeaderAccountPlacement();
  document.getElementById("profilePage")?.classList.add("hidden");
  closeCollectionEditModal();
  viewedProfile = null;
  profileCollections = [];
  editingCollectionId = null;
  showProfileNotFound(false);
  if (push) {
    window.history.pushState(null, "", homeRouteUrl());
  }
}

export function openAccountSettings(): void {
  if (!activeUser) {
    openAuthModal("Create an account or sign in to manage your settings.");
    return;
  }
  setProfileStatus(null);
  fillProfileForm();
  document.getElementById("accountSettingsMod")?.classList.add("show");
}

export function closeAccountSettings(): void {
  document.getElementById("accountSettingsMod")?.classList.remove("show");
  setProfileStatus(null);
}

async function refreshProfile(user: User | null): Promise<void> {
  activeUser = user;
  activeProfile = null;
  updateAuthControl(user);

  if (!user) {
    closeProfilePage(false);
    return;
  }
  try {
    activeProfile = await loadProfile(user);
  } catch (error) {
    console.warn("Unable to load profile", error);
  }
  updateAuthControl(user);
  if (new URLSearchParams(window.location.search).get("profile")) {
    void syncProfileRouteFromUrl();
  }
}

async function handleProfileImageUpload(kind: ProfileImageKind, file: File): Promise<void> {
  if (!activeUser) {
    openAuthModal("Sign in to upload profile images.");
    return;
  }

  const label = kind === "gamerpic" ? "gamerpic" : "banner";
  setProfileStatus(`Uploading ${label}...`);
  try {
    const url = await uploadProfileImage(activeUser, kind, file);
    activeProfile = await saveProfile(
      activeUser,
      {
        ...profileFormValues(),
        ...(kind === "gamerpic" ? { gamerpic_url: url } : { banner_url: url })
      },
      activeProfile
    );
    updateAuthControl(activeUser);
    fillProfileForm();
    setProfileStatus(`${kind === "gamerpic" ? "Gamerpic" : "Banner"} uploaded.`);
  } catch (error) {
    setProfileStatus(error instanceof Error ? error.message : `Could not upload ${label}.`, true);
  }
}

async function submitProfileForm(): Promise<void> {
  if (!activeUser) return;
  const submit = document.getElementById("profile-save") as HTMLButtonElement | null;
  const input = profileFormValues();

  if (!input.gamertag.trim()) {
    setProfileStatus("Gamertag is required.", true);
    return;
  }

  if (submit) submit.disabled = true;
  setProfileStatus("Saving...");
  try {
    activeProfile = await saveProfile(activeUser, input, activeProfile);
    updateAuthControl(activeUser);
    setProfileStatus("Profile updated.");
  } catch (error) {
    setProfileStatus(error instanceof Error ? error.message : "Could not save profile.", true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function submitAuthForm(): Promise<void> {
  const email = (document.getElementById("auth-email") as HTMLInputElement | null)?.value.trim() ?? "";
  const password = (document.getElementById("auth-password") as HTMLInputElement | null)?.value ?? "";

  if (!email || !password) {
    setAuthError("Enter your email and password.");
    return;
  }
  if (password.length < 6) {
    setAuthError("Password must be at least 6 characters.");
    return;
  }

  setAuthBusy(true);
  setAuthError(null);
  const wasSignUp = authMode === "sign-up";
  const error =
    authMode === "sign-in"
      ? await signInWithPassword(email, password)
      : await signUpWithPassword(email, password);
  setAuthBusy(false);

  if (error) {
    setAuthError(error);
    return;
  }

  closeAuthModal();

  if (wasSignUp) {
    window.setTimeout(() => {
      openAccountSettings();
      setProfileStatus("Welcome! Set your gamertag and gamerpic below.", false);
    }, 300);
  }
}

export function bindAuthUi(): void {
  syncHeaderAccountPlacement();
  updateAuthControl(null);

  onAuthChange((user) => {
    void refreshProfile(user);
  });

  document.getElementById("auth-control")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (activeUser) {
      toggleAccountMenu();
      return;
    }
    openAuthModal();
  });

  const accountMenu = document.getElementById("account-menu");
  if (accountMenu) {
    accountMenu.addEventListener("click", (event) => event.stopPropagation());
    if (accountMenu.dataset.bound !== "true") {
      accountMenu.dataset.bound = "true";
      document.addEventListener("click", () => closeAccountMenu());
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeAccountMenu();
      });
    }
  }

  document.getElementById("close-auth")?.addEventListener("click", () => closeAuthModal());
  document.getElementById("authMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAuthModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("authMod")?.classList.contains("show")) closeAuthModal();
    else if (document.getElementById("profileCollectionEditMod")?.classList.contains("show")) closeCollectionEditModal();
  });
  document.getElementById("auth-submit")?.addEventListener("click", () => {
    void submitAuthForm();
  });
  document.querySelectorAll<HTMLElement>("[data-auth-mode]").forEach((node) => {
    node.addEventListener("click", () => setAuthMode((node.dataset.authMode as AuthMode) ?? "sign-in"));
  });

  document.getElementById("auth-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthForm();
  });
  document.getElementById("profile-save")?.addEventListener("click", () => {
    void submitProfileForm();
  });
  document.getElementById("close-account-settings")?.addEventListener("click", () => closeAccountSettings());
  document.getElementById("accountSettingsMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAccountSettings();
  });
  document.getElementById("close-profile-page")?.addEventListener("click", () => closeProfilePage());
  document.getElementById("brand-home")?.addEventListener("click", () => {
    if (document.body.classList.contains("profile-view")) {
      closeProfilePage();
    } else if (document.body.classList.contains("game-view")) {
      window.dispatchEvent(new CustomEvent("xbx-close-game", { detail: { push: true } }));
    } else if (document.body.classList.contains("collection-view")) {
      window.dispatchEvent(new CustomEvent("xbx-close-collection", { detail: { push: true } }));
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  document.getElementById("brand-home")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (document.body.classList.contains("profile-view")) {
      closeProfilePage();
    } else if (document.body.classList.contains("game-view")) {
      window.dispatchEvent(new CustomEvent("xbx-close-game", { detail: { push: true } }));
    } else if (document.body.classList.contains("collection-view")) {
      window.dispatchEvent(new CustomEvent("xbx-close-collection", { detail: { push: true } }));
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  document.getElementById("profile-edit")?.addEventListener("click", () => openAccountSettings());
  document.getElementById("profile-copy-link")?.addEventListener("click", () => {
    void copyProfileLink();
  });
  document.getElementById("close-profile-collection-edit")?.addEventListener("click", () => closeCollectionEditModal());
  document.getElementById("profileCollectionEditMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCollectionEditModal();
  });
  document.getElementById("profile-collection-edit-save")?.addEventListener("click", () => {
    void submitCollectionSettings();
  });
  document.getElementById("profile-collection-edit-delete")?.addEventListener("click", () => {
    if (!editingCollectionId) return;
    const button = document.getElementById("profile-collection-edit-delete") as HTMLButtonElement | null;
    if (!button) return;
    button.dataset.action = "delete";
    button.dataset.collectionId = editingCollectionId;
    void handleProfileCollectionAction(button);
  });
  window.addEventListener("xbx-collections-changed", () => {
    if (document.body.classList.contains("profile-view") && viewedProfile) {
      void refreshProfileCollections();
    }
  });
  window.addEventListener("popstate", () => {
    void syncProfileRouteFromUrl();
  });
  document.getElementById("profile-gamertag")?.addEventListener("input", () => fillProfileForm());
  document.getElementById("profile-bio")?.addEventListener("input", () => fillProfileForm());
  document.getElementById("profile-gamerpic-file")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (file) void handleProfileImageUpload("gamerpic", file);
  });
  document.getElementById("profile-banner-file")?.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (file) void handleProfileImageUpload("banner", file);
  });
}

export function authModalMarkup(): string {
  return `
    <div class="overlay overlay--fit" id="authMod">
      <div class="game-modal game-modal--ambient game-modal--compact">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-auth" type="button" aria-label="Close sign in">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Account</div>
            <h2 class="game-modal-title" id="auth-title">Sign In</h2>
            <p class="game-modal-sub" id="auth-subtitle">Sign in to your xbx.place account.</p>
          </header>
          <section class="game-modal-section">
            <p id="auth-body" class="game-modal-lead hidden" aria-live="polite"></p>
            <div class="auth-pivots" role="tablist" aria-label="Sign in or create account">
              <button type="button" class="auth-pivot active" data-auth-mode="sign-in" role="tab" aria-selected="true">Sign In</button>
              <button type="button" class="auth-pivot" data-auth-mode="sign-up" role="tab" aria-selected="false">Create Account</button>
            </div>
            <form id="auth-form" class="auth-form auth-form--modal" autocomplete="on">
              <div class="game-modal-field">
                <label class="game-meta-label" for="auth-email">Email</label>
                <input id="auth-email" class="inp auth-inp" type="email" name="email" autocomplete="email" required />
              </div>
              <div class="game-modal-field">
                <label class="game-meta-label" for="auth-password">Password</label>
                <input id="auth-password" class="inp auth-inp" type="password" name="password" autocomplete="current-password" minlength="6" required />
              </div>
              <div id="auth-error" class="auth-error hidden" role="alert"></div>
            </form>
            <ul class="auth-perks" aria-label="Account benefits">
              <li><i class="fa-solid fa-id-badge" aria-hidden="true"></i> Gamertag, gamerpic &amp; profile banner</li>
              <li><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Public and private game collections</li>
              <li><i class="fa-solid fa-cloud" aria-hidden="true"></i> Syncs across devices — always free</li>
            </ul>
          </section>
          <div class="game-modal-footer">
            <button class="btn game-modal-footer-primary auth-submit" id="auth-submit" type="submit" form="auth-form">Sign In</button>
          </div>
          </div>
        </div>
      </div>
    </div>
    <section class="profile-page hidden" id="profilePage" aria-label="User profile">
      <div class="profile-page-bg profile-page-bg--fallback" id="profile-banner-preview" aria-hidden="true">
        <div class="profile-page-bg-shade"></div>
      </div>
      <div class="game-page-shell">
        <button class="game-back-link" id="close-profile-page" type="button">
          <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back to Browse</span>
        </button>
        <div id="profile-not-found" class="profile-not-found hidden">
          <h2>Profile not found</h2>
          <p>This gamertag does not match any xbx.place profile.</p>
        </div>
        <div id="profile-view-content" class="profile-page-content">
          <header class="profile-page-head">
            <img class="profile-page-avatar" data-profile-avatar src="${fallbackGamerpic("new-player")}" alt="" />
            <div class="profile-page-identity">
              <div class="profile-page-eyebrow" id="profile-view-handle">@player</div>
              <h1 class="profile-page-title" id="profile-view-name">Player</h1>
              <p class="profile-page-bio" id="profile-view-bio">Add a bio from profile settings.</p>
              <div class="profile-page-meta">
                <span id="profile-view-member-tile">Recently joined</span>
              </div>
            </div>
            <div class="profile-page-actions">
              <button class="btn btn-ghost" id="profile-edit" type="button">
                <i class="fa-solid fa-pen" aria-hidden="true"></i><span>Edit Profile</span>
              </button>
              <button class="btn btn-ghost" id="profile-copy-link" type="button">
                <i class="fa-solid fa-link" aria-hidden="true"></i><span>Copy Link</span>
              </button>
            </div>
          </header>
          <p id="profile-copy-status" class="profile-copy-status hidden" role="status"></p>
          <section class="profile-page-section hidden" id="profile-account-section">
            <h2 class="game-section-title">Account</h2>
            <div class="game-modal-panel game-modal-panel--stack profile-account-panel">
              <div class="profile-account-row">
                <span class="profile-account-label">Email</span>
                <span class="profile-account-value" id="profile-view-email-tile">—</span>
              </div>
              <div class="profile-account-row">
                <span class="profile-account-label">Downloads</span>
                <span class="profile-account-value">Unlimited while signed in</span>
              </div>
            </div>
          </section>
          <section class="profile-page-section" id="profile-collections-section">
            <div class="profile-page-section-head">
              <h2 class="game-section-title">Collections</h2>
              <span class="browse-count" id="profile-collections-count"></span>
            </div>
            <div id="profile-collections-grid" class="profile-collections-grid"></div>
          </section>
        </div>
      </div>
    </section>
    <div class="overlay overlay--fit" id="accountSettingsMod">
      <div class="game-modal game-modal--ambient game-modal--fit">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-account-settings" type="button" aria-label="Close profile settings">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--wide">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">Account</div>
            <h2 class="game-modal-title">Profile Settings</h2>
            <p class="game-modal-sub">Update your gamertag, images, and bio.</p>
          </header>
          <div class="game-modal-layout">
            <aside class="game-modal-sidebar">
              <div class="game-modal-sidebar-card">
                <img id="profile-pic-preview" class="game-modal-sidebar-avatar" src="${fallbackGamerpic("new-player")}" alt="" />
                <div id="profile-display-name" class="game-modal-sidebar-name">Player</div>
                <div id="profile-display-email" class="game-modal-sidebar-email"></div>
              </div>
            </aside>
            <main class="game-modal-main">
              <form class="game-modal-form" id="profile-form">
                <h3 class="game-section-title">Personal Info</h3>
                <div class="game-modal-panel game-modal-panel--stack">
                  <div class="metro-field metro-field--row">
                    <label for="profile-gamertag">Gamertag</label>
                    <input id="profile-gamertag" class="inp" type="text" maxlength="32" autocomplete="nickname" />
                  </div>
                  <div class="metro-field metro-field--row profile-upload-field">
                    <label for="profile-gamerpic-file">Gamerpic</label>
                    <div class="profile-upload-stack">
                      <div class="profile-upload-actions">
                        <label class="btn profile-upload-btn" for="profile-gamerpic-file">
                          <i class="fa-solid fa-upload"></i><span>Upload</span>
                        </label>
                        <input id="profile-gamerpic-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
                      </div>
                      <p class="profile-upload-hint">${profileImageUploadHint("gamerpic")}</p>
                    </div>
                  </div>
                  <div class="metro-field metro-field--row profile-upload-field">
                    <label for="profile-banner-file">Banner</label>
                    <div class="profile-upload-stack">
                      <div class="profile-upload-actions">
                        <label class="btn profile-upload-btn" for="profile-banner-file">
                          <i class="fa-solid fa-upload"></i><span>Upload</span>
                        </label>
                        <input id="profile-banner-file" type="file" accept="image/jpeg,image/png,image/webp" hidden />
                      </div>
                      <p class="profile-upload-hint">${profileImageUploadHint("banner")}</p>
                    </div>
                  </div>
                  <div class="metro-field metro-field--row profile-bio-field">
                    <label for="profile-bio">Bio</label>
                    <textarea id="profile-bio" class="inp text-area text-area--compact" rows="2" maxlength="180" placeholder="Add a short profile bio"></textarea>
                  </div>
                  <div id="profile-status" class="profile-status hidden" role="status"></div>
                </div>
                <div class="game-modal-footer">
                  <button class="btn" id="profile-save" type="button"><i class="fa-solid fa-floppy-disk"></i><span>Save Profile</span></button>
                </div>
              </form>
            </main>
          </div>
          </div>
        </div>
      </div>
    </div>
    <div class="overlay overlay--fit" id="profileCollectionEditMod">
      <div class="game-modal game-modal--ambient">
        <div class="game-modal-bg" aria-hidden="true">
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-profile-collection-edit" type="button" aria-label="Close collection settings">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow profile-collection-edit-shell">
            <header class="game-modal-header">
              <div class="game-modal-eyebrow">Collection</div>
              <h2 class="game-modal-title" id="profile-collection-edit-title">Edit collection</h2>
              <p class="game-modal-sub">Update details, visibility, and games in this list.</p>
            </header>
            <section class="game-modal-section profile-collection-edit-section">
              <div class="game-modal-panel game-modal-panel--stack">
                <div class="metro-field metro-field--row">
                  <label for="profile-collection-edit-name">Name</label>
                  <input id="profile-collection-edit-name" class="inp" type="text" maxlength="64" />
                </div>
                <div class="metro-field metro-field--row profile-bio-field">
                  <label for="profile-collection-edit-description">Description</label>
                  <textarea id="profile-collection-edit-description" class="inp text-area profile-collection-description" maxlength="${COLLECTION_DESCRIPTION_MAX_LEN}" rows="3"></textarea>
                </div>
                <div class="metro-field metro-field--row">
                  <span class="profile-account-label">Visibility</span>
                  <div class="profile-collection-create-visibility">
                    ${checkboxHtml({ id: "profile-collection-edit-public", label: "Public on Collections", className: "ui-check--inline" })}
                  </div>
                </div>
                <div class="profile-collection-settings-actions">
                  <button type="button" class="btn" id="profile-collection-edit-save">
                    <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i><span>Save changes</span>
                  </button>
                  <button type="button" class="profile-collection-action profile-collection-action--danger" id="profile-collection-edit-delete">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i><span>Delete collection</span>
                  </button>
                </div>
                <div id="profile-collection-edit-status" class="profile-collection-settings-status hidden" role="status"></div>
              </div>
              <h3 class="game-section-title profile-collection-manage-title">Games in this list</h3>
              <div class="game-modal-panel profile-collection-manage-panel">
                <div id="profile-collection-manage-games" class="profile-collection-manage-games"></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  `;
}
