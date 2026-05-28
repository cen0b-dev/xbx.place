import type { User } from "@supabase/supabase-js";
import {
  authAvailable,
  onAuthChange,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  type AuthMode
} from "./auth";
import {
  createCollection,
  deleteCollection,
  loadCollectionItems,
  loadMyCollections,
  loadPublicCollections,
  updateCollection,
  type CollectionWithCount
} from "./collections";
import { coverUrl, loadTitles } from "./data";
import { checkboxHtml } from "./form-controls";
import {
  fallbackGamerpic,
  loadProfile,
  loadPublicProfileByGamertag,
  profileImage,
  profileName,
  saveProfile,
  type Profile,
  type ProfileInput,
  type PublicProfile
} from "./profile";
import { profileImageUploadHint, uploadProfileImage, type ProfileImageKind } from "./profile-upload";
import type { TitleEntry } from "./types";

let authMode: AuthMode = "sign-in";
let activeUser: User | null = null;
let activeProfile: Profile | null = null;
let viewedProfile: Profile | PublicProfile | null = null;
let profileViewOwner = true;
let profileCollections: CollectionWithCount[] = [];
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
    node.classList.toggle("active", node.dataset.authMode === mode);
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
        ? "Access unlimited downloads with your xbx.place account."
        : "Join free — one account for downloads, gamerpic, and profile.";
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

export function openAuthModal(reason?: string): void {
  const body = document.getElementById("auth-body");
  if (body && reason) {
    body.textContent = reason;
  } else if (body) {
    body.textContent =
      "Guest downloads are limited to one file. Sign in or create a free account for unlimited downloads.";
  }
  setAuthError(null);
  setAuthMode("sign-in");
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
    gamerpic_url: (document.getElementById("profile-gamerpic") as HTMLInputElement | null)?.value || null,
    banner_url: (document.getElementById("profile-banner") as HTMLInputElement | null)?.value || null,
    bio: (document.getElementById("profile-bio") as HTMLTextAreaElement | null)?.value || null
  };
}

function fillProfileForm(): void {
  const name = profileName(activeProfile, activeUser);
  const image = profileImage(activeProfile, activeUser);
  const banner = activeProfile?.banner_url || "";
  const bio = activeProfile?.bio || "";
  const email = activeUser?.email ?? "";
  const handle = `@${name.replace(/\s+/g, "").toLowerCase()}`;
  const memberSince = formatMemberSince(activeProfile?.created_at);
  const gamerpicPreview = document.getElementById("profile-pic-preview") as HTMLImageElement | null;
  const bannerPreview = document.getElementById("profile-banner-preview") as HTMLImageElement | null;
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
  const gamerpic = document.getElementById("profile-gamerpic") as HTMLInputElement | null;
  const bannerInput = document.getElementById("profile-banner") as HTMLInputElement | null;
  const bioInput = document.getElementById("profile-bio") as HTMLTextAreaElement | null;
  if (gamertag) gamertag.value = name;
  if (gamerpic) gamerpic.value = activeProfile?.gamerpic_url ?? "";
  if (bannerInput) bannerInput.value = banner;
  if (bioInput) bioInput.value = bio;
  if (gamerpicPreview) gamerpicPreview.src = image;
  if (bannerPreview) {
    bannerPreview.style.backgroundImage = banner ? `url("${banner}")` : "";
  }
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
  document.getElementById("profile-collection-create")?.classList.toggle("hidden", !isOwner);
}

function showProfileNotFound(show: boolean): void {
  document.getElementById("profile-not-found")?.classList.toggle("hidden", !show);
  document.getElementById("profile-view-content")?.classList.toggle("hidden", show);
  document.getElementById("profile-collections-section")?.classList.toggle("hidden", show);
}

function fillPublicProfileView(profile: PublicProfile): void {
  const name = profile.gamertag.trim() || "Player";
  const image = profile.gamerpic_url || fallbackGamerpic(profile.gamertag);
  const banner = profile.banner_url || "";
  const bio = profile.bio || "";
  const handle = profileHandleFromName(name);
  const memberSince = formatMemberSince(profile.created_at);
  const bannerPreview = document.getElementById("profile-banner-preview") as HTMLElement | null;

  setText("profile-view-name", name);
  setText("profile-view-bio", bio || "No bio yet.");
  setText("profile-view-handle", handle);
  setText("profile-view-member-tile", memberSince);
  if (bannerPreview) {
    bannerPreview.style.backgroundImage = banner ? `url("${banner}")` : "";
  }
  document.querySelectorAll<HTMLImageElement>("[data-profile-avatar]").forEach((img) => {
    img.src = image;
  });
  updateProfileOwnerControls(false);
  showProfileNotFound(false);
}

async function renderCollectionGames(container: HTMLElement, collectionId: string): Promise<void> {
  const titleIds = await loadCollectionItems(collectionId);
  const index = await getTitleIndex();
  if (!titleIds.length) {
    container.innerHTML = `<p class="profile-collection-empty">No games in this collection yet.</p>`;
    return;
  }

  container.innerHTML = `<div class="profile-collection-games-grid">${titleIds
    .map((titleId) => {
      const game = index.get(titleId);
      if (!game) {
        return `<div class="profile-collection-game profile-collection-game--missing"><span>${escapeHtml(titleId)}</span></div>`;
      }
      return `
        <button class="profile-collection-game" type="button" data-title-id="${escapeHtml(game.title_id)}">
          <img src="${coverUrl(game.title_id)}" alt="" loading="lazy" />
          <span>${escapeHtml(game.name)}</span>
        </button>
      `;
    })
    .join("")}</div>`;

  container.querySelectorAll<HTMLButtonElement>("[data-title-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const titleId = button.dataset.titleId;
      if (!titleId) return;
      window.dispatchEvent(new CustomEvent("xbx-open-game", { detail: { titleId } }));
    });
  });
}

function renderProfileCollectionCards(isOwner: boolean): void {
  const grid = document.getElementById("profile-collections-grid");
  if (!grid) return;

  if (!profileCollections.length) {
    grid.innerHTML = `<p class="profile-collections-empty">${isOwner ? "Create a collection to start saving games." : "No public collections yet."}</p>`;
    return;
  }

  grid.innerHTML = profileCollections
    .map((collection) => {
      const visibility = collection.is_public ? "Public" : "Private";
      const actions = isOwner
        ? `
          <div class="profile-collection-actions">
            <button class="profile-collection-action" type="button" data-action="toggle-public" data-collection-id="${collection.id}">
              ${collection.is_public ? "Make private" : "Make public"}
            </button>
            <button class="profile-collection-action" type="button" data-action="expand" data-collection-id="${collection.id}">View games</button>
            <button class="profile-collection-action profile-collection-action--danger" type="button" data-action="delete" data-collection-id="${collection.id}">Delete</button>
          </div>
        `
        : `
          <div class="profile-collection-actions">
            <button class="profile-collection-action" type="button" data-action="expand" data-collection-id="${collection.id}">View games</button>
          </div>
        `;
      return `
        <article class="profile-collection-card" data-collection-id="${collection.id}">
          <div class="profile-collection-head">
            <h3 class="profile-collection-name">${escapeHtml(collection.name)}</h3>
            <div class="profile-collection-meta">
              <span class="profile-collection-badge ${collection.is_public ? "is-public" : "is-private"}">${visibility}</span>
              <span>${collection.item_count} game${collection.item_count === 1 ? "" : "s"}</span>
            </div>
          </div>
          ${actions}
          <div class="profile-collection-games hidden" id="profile-collection-games-${collection.id}"></div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleProfileCollectionAction(button);
    });
  });
}

async function handleProfileCollectionAction(button: HTMLButtonElement): Promise<void> {
  const action = button.dataset.action;
  const collectionId = button.dataset.collectionId;
  if (!action || !collectionId) return;

  if (action === "expand") {
    const panel = document.getElementById(`profile-collection-games-${collectionId}`);
    if (!panel) return;
    const hidden = panel.classList.contains("hidden");
    if (hidden) {
      panel.classList.remove("hidden");
      button.textContent = "Hide games";
      await renderCollectionGames(panel, collectionId);
    } else {
      panel.classList.add("hidden");
      button.textContent = "View games";
    }
    return;
  }

  if (!profileViewOwner || !activeUser) return;

  if (action === "toggle-public") {
    const collection = profileCollections.find((row) => row.id === collectionId);
    if (!collection) return;
    button.disabled = true;
    try {
      await updateCollection(collectionId, { is_public: !collection.is_public });
      await refreshProfileCollections();
    } catch (error) {
      console.warn(error);
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (action === "delete") {
    const collection = profileCollections.find((row) => row.id === collectionId);
    if (!collection) return;
    if (!window.confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;
    button.disabled = true;
    try {
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
  renderProfileCollectionCards(profileViewOwner);
}

async function submitProfileCollectionCreate(): Promise<void> {
  if (!activeUser) {
    openAuthModal("Sign in to create collections.");
    return;
  }

  const nameInput = document.getElementById("profile-collection-name") as HTMLInputElement | null;
  const publicInput = document.getElementById("profile-collection-public") as HTMLInputElement | null;
  const status = document.getElementById("profile-collection-status");
  const name = nameInput?.value.trim() ?? "";
  if (!name) {
    if (status) {
      status.textContent = "Enter a collection name.";
      status.classList.remove("hidden");
    }
    return;
  }

  try {
    await createCollection(activeUser, {
      name,
      is_public: publicInput?.checked ?? false
    });
    if (nameInput) nameInput.value = "";
    if (publicInput) publicInput.checked = false;
    if (status) {
      status.textContent = "Collection created.";
      status.classList.remove("hidden");
    }
    await refreshProfileCollections();
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : "Could not create collection.";
      status.classList.remove("hidden");
    }
  }
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
    document.body.classList.contains("game-view") || document.body.classList.contains("profile-view")
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
    btn.innerHTML = `<img class="account-trigger-pic" data-profile-avatar src="${profileImage(
      activeProfile,
      user
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
  const image = profileImage(activeProfile, activeUser);

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

async function openPublicProfileByGamertag(gamertag: string, push = true): Promise<void> {
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
      renderProfileCollectionCards(false);
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
    return;
  }
  await openPublicProfileByGamertag(param, false);
}

export function closeProfilePage(push = true): void {
  document.body.classList.remove("profile-view");
  syncHeaderAccountPlacement();
  document.getElementById("profilePage")?.classList.add("hidden");
  viewedProfile = null;
  profileCollections = [];
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
    const input = document.getElementById(kind === "gamerpic" ? "profile-gamerpic" : "profile-banner") as
      | HTMLInputElement
      | null;
    if (input) input.value = url;
    activeProfile = await saveProfile(activeUser, profileFormValues());
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
    activeProfile = await saveProfile(activeUser, input);
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
  document.getElementById("header-back-browse")?.addEventListener("click", () => closeProfilePage());
  document.getElementById("brand-home")?.addEventListener("click", () => {
    if (document.body.classList.contains("profile-view")) {
      closeProfilePage();
    } else if (document.body.classList.contains("game-view")) {
      window.dispatchEvent(new CustomEvent("xbx-close-game", { detail: { push: true } }));
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
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  document.getElementById("profile-edit")?.addEventListener("click", () => openAccountSettings());
  document.getElementById("profile-copy-link")?.addEventListener("click", () => {
    void copyProfileLink();
  });
  document.getElementById("profile-collection-create-btn")?.addEventListener("click", () => {
    void submitProfileCollectionCreate();
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
  document.getElementById("profile-gamerpic")?.addEventListener("input", () => fillProfileForm());
  document.getElementById("profile-banner")?.addEventListener("input", () => fillProfileForm());
  document.getElementById("profile-bio")?.addEventListener("input", () => fillProfileForm());
  document.getElementById("profile-random-pic")?.addEventListener("click", () => {
    const input = document.getElementById("profile-gamerpic") as HTMLInputElement | null;
    if (!input) return;
    input.value = fallbackGamerpic(`${Date.now()}`);
    fillProfileForm();
  });
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
    <div class="overlay" id="authMod">
      <div class="game-modal game-modal--ambient">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-auth" type="button" aria-label="Close sign in">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
          <header class="game-modal-header">
            <div class="game-modal-eyebrow">xbx.place account</div>
            <h2 class="game-modal-title" id="auth-title">Sign In</h2>
            <p class="game-modal-sub" id="auth-subtitle">Access unlimited downloads with your xbx.place account.</p>
          </header>
          <section class="game-modal-section">
            <p id="auth-body" class="game-modal-lead">
              Guest downloads are limited to one file. Sign in or create a free account for unlimited downloads.
            </p>
            <div class="game-modal-panel game-modal-panel--stack">
              <div class="auth-pivots">
                <button type="button" class="auth-pivot active" data-auth-mode="sign-in">Sign In</button>
                <button type="button" class="auth-pivot" data-auth-mode="sign-up">Create Account</button>
              </div>
              <form id="auth-form" class="auth-form" autocomplete="on">
                <div class="game-modal-field">
                  <label class="game-meta-label" for="auth-email">Email</label>
                  <input id="auth-email" class="inp auth-inp" type="email" name="email" autocomplete="email" required />
                </div>
                <div class="game-modal-field">
                  <label class="game-meta-label" for="auth-password">Password</label>
                  <input id="auth-password" class="inp auth-inp" type="password" name="password" autocomplete="current-password" minlength="6" required />
                </div>
                <div id="auth-error" class="auth-error hidden" role="alert"></div>
                <ul class="auth-perks" aria-label="Account benefits">
                  <li><i class="fa-solid fa-download"></i> Unlimited archive downloads</li>
                  <li><i class="fa-solid fa-id-badge"></i> Gamertag, gamerpic &amp; collections</li>
                  <li><i class="fa-solid fa-cloud"></i> Syncs across devices</li>
                </ul>
              </form>
            </div>
          </section>
          <div class="game-modal-footer">
            <button class="btn auth-submit" id="auth-submit" type="submit" form="auth-form">Sign In</button>
          </div>
          </div>
        </div>
      </div>
    </div>
    <section class="profile-hub hidden" id="profilePage" aria-label="User profile">
      <div class="profile-hub-banner" id="profile-banner-preview">
        <div class="profile-hub-banner-shade"></div>
      </div>
      <div class="profile-hub-shell">
        <div id="profile-not-found" class="profile-not-found hidden">
          <h2>Profile not found</h2>
          <p>This gamertag does not match any xbx.place profile.</p>
        </div>
        <div id="profile-view-content">
          <div class="profile-identity-card">
            <img class="profile-identity-avatar" data-profile-avatar src="${fallbackGamerpic("new-player")}" alt="" />
            <div class="profile-identity-copy">
              <div class="profile-identity-kicker" id="profile-view-handle">@player</div>
              <h2 id="profile-view-name">Player</h2>
              <p id="profile-view-bio" class="profile-identity-bio">Add a bio from profile settings.</p>
            </div>
            <div class="profile-identity-actions">
              <button class="hub-tile" id="profile-edit" type="button">
                <i class="fa-solid fa-pen"></i>
                <span>Edit Profile</span>
              </button>
              <button class="hub-tile" id="profile-copy-link" type="button">
                <i class="fa-solid fa-link"></i>
                <span>Copy Profile Link</span>
              </button>
            </div>
          </div>
          <p id="profile-copy-status" class="profile-copy-status hidden" role="status"></p>
        </div>
        <div class="profile-hub-section" id="profile-account-section">
          <div class="hub-section-title">Account</div>
          <div class="profile-info-tiles">
            <div class="profile-info-tile">
              <div class="profile-info-tile-label">Email</div>
              <div class="profile-info-tile-value" id="profile-view-email-tile">—</div>
            </div>
            <div class="profile-info-tile">
              <div class="profile-info-tile-label">Downloads</div>
              <div class="profile-info-tile-value">Unlimited while signed in</div>
            </div>
            <div class="profile-info-tile">
              <div class="profile-info-tile-label">Member Since</div>
              <div class="profile-info-tile-value" id="profile-view-member-tile">Recently joined</div>
            </div>
          </div>
        </div>
        <div class="profile-hub-section" id="profile-collections-section">
          <div class="hub-section-title">Collections</div>
          <div id="profile-collection-create" class="profile-collection-create">
            <div class="profile-collection-create-form">
              <input id="profile-collection-name" class="inp" type="text" maxlength="64" placeholder="New collection name" />
              ${checkboxHtml({ id: "profile-collection-public", label: "Public on profile", className: "ui-check--inline" })}
              <button class="btn" id="profile-collection-create-btn" type="button">
                <i class="fa-solid fa-folder-plus"></i><span>New collection</span>
              </button>
            </div>
            <div id="profile-collection-status" class="profile-collection-status hidden" role="status"></div>
          </div>
          <div id="profile-collections-grid" class="profile-collections-grid"></div>
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
                        <button class="icon-btn" id="profile-random-pic" type="button" aria-label="Use generated gamerpic"><i class="fa-solid fa-dice"></i></button>
                      </div>
                      <p class="profile-upload-hint">${profileImageUploadHint("gamerpic")}</p>
                      <input id="profile-gamerpic" class="inp" type="url" placeholder="Or paste image URL" />
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
                      <input id="profile-banner" class="inp" type="url" placeholder="Or paste banner URL" />
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
  `;
}
