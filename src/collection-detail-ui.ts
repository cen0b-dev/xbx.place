import type { User } from "@supabase/supabase-js";
import { isSiteAdmin } from "./admin";
import { getCurrentUser, onAuthChange } from "./auth";
import { openAuthModal, openPublicProfileByGamertag, syncHeaderAccountPlacement } from "./auth-ui";
import {
  COLLECTION_COMMENT_MAX_LEN,
  COLLECTION_COMMENTS_PAGE_SIZE,
  deleteCollectionComment,
  loadCollectionComments,
  postCollectionComment,
  type CollectionComment
} from "./collection-comments";
import { createGridCard } from "./browse-card";
import { loadCollectionItems, loadPublicCollectionById, type DiscoverCollection } from "./collections";
import { observeRevealChildren } from "./reveal";
import { fallbackGamerpic, profileImage } from "./profile";
import { sanitizeProfileImageUrl } from "./sanitize";
import type { TitleEntry } from "./types";

type TitleIndex = Map<string, TitleEntry>;

let activeCollection: DiscoverCollection | null = null;
let activeUser: User | null = null;
let titleIndex: TitleIndex = new Map();
let titleIds: string[] = [];
let comments: CollectionComment[] = [];
let commentPage = 0;
let hasMoreComments = false;
let commentsLoading = false;
let commentsPosting = false;
let lastCommentPostTime = 0;

const POST_COOLDOWN_MS = 15_000;

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

export function collectionShareUrl(collectionId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("title");
  url.searchParams.delete("profile");
  url.searchParams.set("collection", collectionId);
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function commenterAvatarUrl(comment: CollectionComment): string {
  const validated = sanitizeProfileImageUrl(comment.gamerpic_url, comment.user_id, "gamerpic");
  return validated ?? fallbackGamerpic(comment.gamertag);
}

function commentCardHtml(comment: CollectionComment, isOwn: boolean, isAdmin: boolean): string {
  const avatar = commenterAvatarUrl(comment);
  const gamertag = escapeHtml(comment.gamertag);
  const body = escapeHtml(comment.body);
  const time = timeAgo(comment.created_at);
  const ownClass = isOwn ? " comment-card--own" : "";
  const canDelete = isOwn || isAdmin;
  const deleteBtn = canDelete
    ? `<button class="comment-delete-btn" data-collection-comment-id="${escapeHtml(comment.id)}" type="button" aria-label="Delete comment"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`
    : "";

  return `<div class="comment-card${ownClass}" data-collection-comment-id="${escapeHtml(comment.id)}">
    <img class="comment-avatar" src="${escapeHtml(avatar)}" alt="${gamertag}" loading="lazy" />
    <div class="comment-content">
      <div class="comment-meta">
        <span class="comment-gamertag">${gamertag}</span>
        <span class="comment-time" title="${escapeHtml(comment.created_at)}">${time}</span>
        <span class="comment-meta-actions">${deleteBtn}</span>
      </div>
      <p class="comment-body">${body}</p>
    </div>
  </div>`;
}

function setCollectionBrowseVisible(open: boolean): void {
  document.body.classList.toggle("collection-view", open);
  const page = document.getElementById("collectionPage");
  if (page) {
    page.classList.toggle("hidden", !open);
    page.setAttribute("aria-hidden", open ? "false" : "true");
  }
  syncHeaderAccountPlacement();
  if (open) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

function renderGamesGrid(): void {
  const grid = document.getElementById("collection-detail-games");
  if (!grid) return;

  grid.replaceChildren();

  if (!titleIds.length) {
    grid.className = "collection-detail-games-empty";
    grid.innerHTML = `<p class="collection-detail-empty">No games in this collection yet.</p>`;
    return;
  }

  grid.className = "browse-grid";

  for (const titleId of titleIds) {
    const game = titleIndex.get(titleId);
    if (!game) continue;

    let badge = "";
    if (game.downloads.some((d) => d.type === "DLC")) badge = "+ Addons";

    const card = createGridCard(game, {
      badge,
      dimmed: !game.downloads?.length,
      onActivate: (_node, entry) => {
        window.dispatchEvent(new CustomEvent("xbx-open-game", { detail: { titleId: entry.title_id } }));
      }
    });
    grid.appendChild(card);
  }

  observeRevealChildren(grid, ".browse-card", 45);
}

function renderCommentFormHtml(): string {
  if (!activeUser) {
    return `<div class="comments-signin-prompt">
      <i class="fa-solid fa-comment-dots" aria-hidden="true"></i>
      <p>Sign in to comment on this collection.</p>
      <button class="btn comments-signin-btn" type="button" id="collection-comment-signin-btn">Sign in</button>
    </div>`;
  }

  return `<form class="comment-form" id="collection-comment-form" novalidate>
    <textarea
      class="comment-textarea inp"
      id="collection-comment-textarea"
      placeholder="Share your thoughts on this list…"
      maxlength="${COLLECTION_COMMENT_MAX_LEN}"
      rows="3"
      aria-label="Comment on collection"
    ></textarea>
    <div class="comment-form-footer">
      <span class="comment-char-count" id="collection-comment-char-count">0/${COLLECTION_COMMENT_MAX_LEN}</span>
      <button class="btn comment-submit-btn" type="submit" id="collection-comment-submit-btn">
        <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Post
      </button>
    </div>
    <div class="comment-post-status hidden" id="collection-comment-post-status" role="status"></div>
  </form>`;
}

function renderCommentsList(): void {
  const list = document.getElementById("collection-detail-comments-list");
  const heading = document.getElementById("collection-detail-comments-title");
  if (!list) return;

  if (heading) {
    heading.textContent = comments.length > 0 ? `Comments (${comments.length.toLocaleString()})` : "Comments";
  }

  if (commentsLoading && comments.length === 0) {
    list.innerHTML = `<div class="comments-loading"><span class="comment-spinner"></span> Loading comments…</div>`;
    return;
  }

  if (!comments.length) {
    list.innerHTML = `<div class="comments-empty">No comments yet. Start the conversation.</div>`;
    return;
  }

  const userId = activeUser?.id ?? null;
  const isAdmin = isSiteAdmin(activeUser);
  const cards = comments.map((comment) => commentCardHtml(comment, comment.user_id === userId, isAdmin)).join("");
  const loadMore = hasMoreComments
    ? `<button class="comments-load-more" type="button" id="collection-comments-load-more" ${commentsLoading ? "disabled" : ""}>
        ${commentsLoading ? "Loading…" : "Load more comments"}
      </button>`
    : "";

  list.innerHTML = `<div class="comments-list">${cards}</div>${loadMore}`;
}

function renderCommentsSection(): void {
  const body = document.getElementById("collection-detail-comments-body");
  if (!body) return;
  body.innerHTML = `${renderCommentFormHtml()}<div id="collection-detail-comments-list"></div>`;
  renderCommentsList();

  document.getElementById("collection-comment-signin-btn")?.addEventListener("click", () => {
    openAuthModal("Sign in to comment on collections.");
  });

  const textarea = document.getElementById("collection-comment-textarea") as HTMLTextAreaElement | null;
  textarea?.addEventListener("input", () => {
    const counter = document.getElementById("collection-comment-char-count");
    if (!counter) return;
    counter.textContent = `${textarea.value.length}/${COLLECTION_COMMENT_MAX_LEN}`;
    counter.classList.toggle("comment-char-count--over", textarea.value.length > COLLECTION_COMMENT_MAX_LEN);
  });

  document.getElementById("collection-comment-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlePostComment();
  });

  body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const deleteBtn = target.closest<HTMLButtonElement>(".comment-delete-btn[data-collection-comment-id]");
    if (deleteBtn?.dataset.collectionCommentId) {
      void handleDeleteComment(deleteBtn.dataset.collectionCommentId);
      return;
    }
    if (target.closest("#collection-comments-load-more")) {
      void handleLoadMoreComments();
    }
  });
}

function renderDetailHeader(): void {
  if (!activeCollection) return;

  const ownerPic = profileImage(
    {
      id: activeCollection.user_id,
      gamertag: activeCollection.owner_gamertag,
      gamerpic_url: activeCollection.owner_gamerpic_url
    },
    null
  );

  const title = document.getElementById("collection-detail-title");
  const ownerBtn = document.getElementById("collection-detail-owner");
  const ownerPicEl = document.getElementById("collection-detail-owner-pic") as HTMLImageElement | null;
  const count = document.getElementById("collection-detail-count");
  const description = document.getElementById("collection-detail-description");

  if (title) title.textContent = activeCollection.name;
  if (ownerBtn) {
    const label = ownerBtn.querySelector("span");
    if (label) label.textContent = activeCollection.owner_gamertag;
  }
  if (ownerPicEl) ownerPicEl.src = ownerPic;
  if (count) {
    count.textContent = `${activeCollection.item_count} game${activeCollection.item_count === 1 ? "" : "s"}`;
  }
  if (description) {
    const copy = activeCollection.description?.trim();
    if (copy) {
      description.textContent = copy;
      description.classList.remove("hidden");
    } else {
      description.textContent = "";
      description.classList.add("hidden");
    }
  }
}

function renderDetailShell(): void {
  renderDetailHeader();
  renderGamesGrid();
  renderCommentsSection();
}

async function handlePostComment(): Promise<void> {
  if (!activeUser || !activeCollection || commentsPosting) return;

  const textarea = document.getElementById("collection-comment-textarea") as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById("collection-comment-submit-btn") as HTMLButtonElement | null;
  const status = document.getElementById("collection-comment-post-status");
  if (!textarea || !submitBtn) return;

  const body = textarea.value.trim();
  if (!body) {
    if (status) {
      status.textContent = "Comment cannot be empty.";
      status.className = "comment-post-status error";
      status.classList.remove("hidden");
    }
    return;
  }

  const now = Date.now();
  if (now - lastCommentPostTime < POST_COOLDOWN_MS) {
    const wait = Math.ceil((POST_COOLDOWN_MS - (now - lastCommentPostTime)) / 1000);
    if (status) {
      status.textContent = `Please wait ${wait}s before posting again.`;
      status.className = "comment-post-status error";
      status.classList.remove("hidden");
    }
    return;
  }

  commentsPosting = true;
  submitBtn.disabled = true;
  if (status) status.classList.add("hidden");

  try {
    const comment = await postCollectionComment(activeUser, activeCollection.id, body);
    lastCommentPostTime = Date.now();
    textarea.value = "";
    if (comment) {
      comments = [comment, ...comments];
      renderCommentsList();
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : "Could not post comment.";
      status.className = "comment-post-status error";
      status.classList.remove("hidden");
    }
  } finally {
    commentsPosting = false;
    submitBtn.disabled = false;
  }
}

async function handleDeleteComment(commentId: string): Promise<void> {
  try {
    await deleteCollectionComment(commentId);
    comments = comments.filter((row) => row.id !== commentId);
    renderCommentsList();
  } catch {
    // ignore
  }
}

async function handleLoadMoreComments(): Promise<void> {
  if (!activeCollection || commentsLoading || !hasMoreComments) return;
  commentsLoading = true;
  renderCommentsList();
  commentPage += 1;
  try {
    const next = await loadCollectionComments(activeCollection.id, commentPage);
    hasMoreComments = next.length === COLLECTION_COMMENTS_PAGE_SIZE;
    comments = [...comments, ...next];
  } catch {
    commentPage -= 1;
  } finally {
    commentsLoading = false;
    renderCommentsList();
  }
}

async function loadComments(): Promise<void> {
  if (!activeCollection) return;
  commentsLoading = true;
  commentPage = 0;
  renderCommentsList();
  try {
    comments = await loadCollectionComments(activeCollection.id, 0);
    hasMoreComments = comments.length === COLLECTION_COMMENTS_PAGE_SIZE;
  } catch {
    comments = [];
    hasMoreComments = false;
  } finally {
    commentsLoading = false;
    renderCommentsList();
  }
}

async function loadDetailData(collectionId: string): Promise<boolean> {
  const shell = document.getElementById("collection-detail-content");
  const scroll = document.getElementById("collection-detail-scroll");
  shell?.classList.add("is-loading");
  scroll?.classList.add("is-loading");

  try {
    const collection = await loadPublicCollectionById(collectionId);
    if (!collection) return false;

    activeCollection = collection;
    titleIds = await loadCollectionItems(collectionId);
    comments = [];
    commentPage = 0;
    hasMoreComments = false;
    renderDetailShell();
    void loadComments();
    return true;
  } finally {
    shell?.classList.remove("is-loading");
    scroll?.classList.remove("is-loading");
  }
}

export function closeCollectionDetail(push = true): void {
  setCollectionBrowseVisible(false);
  activeCollection = null;
  titleIds = [];
  comments = [];
  if (push) {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("collection")) return;
    url.searchParams.delete("collection");
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

export async function openCollectionDetail(collectionId: string, push = true): Promise<boolean> {
  window.dispatchEvent(new CustomEvent("xbx-open-collections-tab"));
  setCollectionBrowseVisible(true);

  const ok = await loadDetailData(collectionId);
  if (!ok) {
    closeCollectionDetail(false);
    return false;
  }

  if (push) {
    const url = new URL(window.location.href);
    url.searchParams.delete("title");
    url.searchParams.delete("profile");
    url.searchParams.set("collection", collectionId);
    window.history.pushState({ collection: collectionId }, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return true;
}

export async function syncCollectionRouteFromUrl(): Promise<void> {
  const param = new URLSearchParams(window.location.search).get("collection");
  if (!param) {
    closeCollectionDetail(false);
    return;
  }
  await openCollectionDetail(param, false);
}

export function setCollectionDetailTitleIndex(index: Map<string, TitleEntry>): void {
  titleIndex = index;
  if (activeCollection) renderGamesGrid();
}

export function bindCollectionDetailUi(): void {
  onAuthChange((user) => {
    activeUser = user;
    if (activeCollection) renderCommentsSection();
  });
  activeUser = getCurrentUser();

  document.getElementById("close-collection-detail")?.addEventListener("click", () => closeCollectionDetail());
  document.getElementById("collection-detail-share")?.addEventListener("click", () => {
    if (!activeCollection) return;
    const url = collectionShareUrl(activeCollection.id);
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        const status = document.getElementById("collection-detail-share-status");
        if (!status) return;
        status.textContent = "Link copied.";
        status.classList.remove("hidden");
        window.setTimeout(() => status.classList.add("hidden"), 2000);
      })
      .catch(() => {
        window.prompt("Copy collection link:", url);
      });
  });
  document.getElementById("collection-detail-owner")?.addEventListener("click", () => {
    if (!activeCollection) return;
    closeCollectionDetail(false);
    void openPublicProfileByGamertag(activeCollection.owner_gamertag, true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.body.classList.contains("collection-view")) return;
    if (document.body.classList.contains("game-view")) return;
    closeCollectionDetail();
  });
}
