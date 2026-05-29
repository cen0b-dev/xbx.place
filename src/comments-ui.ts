import { isSiteAdmin } from "./admin";
import { getCurrentUser, onAuthChange } from "./auth";
import { openAuthModal } from "./auth-ui";
import { openCommentReportModal } from "./comment-report";
import { fallbackGamerpic, profileImage } from "./profile";
import { sanitizeProfileImageUrl } from "./sanitize";
import { COMMENT_MAX_LEN, COMMENTS_PAGE_SIZE, deleteComment, loadComments, postComment, type GameComment } from "./comments";
import type { TitleEntry } from "./types";
import type { User } from "@supabase/supabase-js";

let activeGame: TitleEntry | null = null;
let activeUser: User | null = null;
let comments: GameComment[] = [];
let commentPage = 0;
let hasMore = false;
let isLoading = false;
let isPosting = false;
let lastPostTime = 0;

const POST_COOLDOWN_MS = 15_000;

function escapeHtml(value: string): string {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

/** Base game releases only — not add-on-only catalog entries. */
function isGameRelease(entry: TitleEntry): boolean {
  return (
    entry.downloads.length === 0 ||
    entry.downloads.some((d) => d.type === "Game" || !d.type || d.type === "ROM")
  );
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

function commenterAvatarUrl(comment: GameComment): string {
  const validated = sanitizeProfileImageUrl(comment.gamerpic_url, comment.user_id, "gamerpic");
  return validated ?? fallbackGamerpic(comment.gamertag);
}

function commentCardHtml(comment: GameComment, isOwn: boolean, isAdmin: boolean): string {
  const avatar = commenterAvatarUrl(comment);
  const gamertag = escapeHtml(comment.gamertag);
  const body = escapeHtml(comment.body);
  const time = timeAgo(comment.created_at);
  const ownClass = isOwn ? " comment-card--own" : "";
  const canDelete = isOwn || isAdmin;
  const modClass = isAdmin && !isOwn ? " comment-delete-btn--mod" : "";
  const deleteLabel = isAdmin && !isOwn ? "Delete comment (moderator)" : "Delete comment";
  const deleteBtn = canDelete
    ? `<button
         class="comment-delete-btn${modClass}"
         data-comment-id="${escapeHtml(comment.id)}"
         data-mod-delete="${isAdmin && !isOwn ? "1" : "0"}"
         type="button"
         aria-label="${deleteLabel}"
         title="${deleteLabel}"
       ><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>`
    : "";
  const reportBtn = !isOwn && !isAdmin
    ? `<button
         class="comment-report-btn"
         data-comment-id="${escapeHtml(comment.id)}"
         type="button"
         aria-label="Report comment"
         title="Report comment"
       ><i class="fa-solid fa-flag" aria-hidden="true"></i></button>`
    : "";

  return `<div class="comment-card${ownClass}" data-comment-id="${escapeHtml(comment.id)}">
  <img class="comment-avatar" src="${escapeHtml(avatar)}" alt="${gamertag}" loading="lazy" />
  <div class="comment-content">
    <div class="comment-meta">
      <span class="comment-gamertag">${gamertag}</span>
      <span class="comment-time" title="${escapeHtml(comment.created_at)}">${time}</span>
      <span class="comment-meta-actions">${reportBtn}${deleteBtn}</span>
    </div>
    <p class="comment-body">${body}</p>
  </div>
</div>`;
}

function updateSectionHeading(count: number): void {
  const heading = document.querySelector<HTMLElement>("#gp-comments-section .game-section-title");
  if (!heading) return;
  heading.textContent = count > 0 ? `Comments (${count.toLocaleString()})` : "Comments";
}

function renderCommentList(container: HTMLElement): void {
  const userId = activeUser?.id ?? null;
  const isAdmin = isSiteAdmin(activeUser);

  if (isLoading && comments.length === 0) {
    container.innerHTML = `<div class="comments-loading"><span class="comment-spinner"></span> Loading comments…</div>`;
    return;
  }

  if (comments.length === 0) {
    container.innerHTML = `<div class="comments-empty">No comments yet. Be the first to leave one.</div>`;
    return;
  }

  const listHtml = comments.map((c) => commentCardHtml(c, c.user_id === userId, isAdmin)).join("");
  const loadMoreHtml = hasMore
    ? `<button class="comments-load-more" type="button" ${isLoading ? "disabled" : ""}>
        ${isLoading ? "Loading…" : "Load more comments"}
       </button>`
    : "";

  container.innerHTML = `<div class="comments-list">${listHtml}</div>${loadMoreHtml}`;
}

function getCommentForm(): HTMLElement | null {
  return document.getElementById("gp-comment-form");
}

function getCommentBody(): HTMLElement | null {
  return document.getElementById("gp-comments-body");
}

function updateCharCount(textarea: HTMLTextAreaElement): void {
  const counter = document.getElementById("comment-char-count");
  if (!counter) return;
  const len = textarea.value.length;
  counter.textContent = `${len}/${COMMENT_MAX_LEN}`;
  counter.classList.toggle("comment-char-count--over", len > COMMENT_MAX_LEN);
}

function setPostStatus(message: string | null, isError = false): void {
  const el = document.getElementById("comment-post-status");
  if (!el) return;
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.className = isError ? "comment-post-status error" : "comment-post-status";
}

function renderCommentForm(): string {
  if (!activeUser) {
    return `<div class="comments-signin-prompt">
  <i class="fa-solid fa-comment-dots" aria-hidden="true"></i>
  <p>Sign in to leave a comment on this game.</p>
  <button class="btn comments-signin-btn" type="button" id="comments-signin-btn">Sign in</button>
</div>`;
  }

  return `<form class="comment-form" id="gp-comment-form" novalidate>
  <textarea
    class="comment-textarea inp"
    id="comment-textarea"
    placeholder="Write a comment…"
    maxlength="${COMMENT_MAX_LEN}"
    rows="3"
    aria-label="Comment"
  ></textarea>
  <div class="comment-form-footer">
    <span class="comment-char-count" id="comment-char-count">0/${COMMENT_MAX_LEN}</span>
    <button class="btn comment-submit-btn" type="submit" id="comment-submit-btn">
      <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>Post
    </button>
  </div>
  <div class="comment-post-status hidden" id="comment-post-status" role="status"></div>
</form>`;
}

function renderSection(): void {
  const section = document.getElementById("gp-comments-section");
  const body = getCommentBody();
  if (!section || !body) return;

  if (!activeGame || !isGameRelease(activeGame)) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  body.innerHTML = renderCommentForm() + `<div id="gp-comments-list"></div>`;

  const textarea = document.getElementById("comment-textarea") as HTMLTextAreaElement | null;
  const listEl = document.getElementById("gp-comments-list");

  if (textarea) {
    textarea.addEventListener("input", () => updateCharCount(textarea));
  }

  document.getElementById("comments-signin-btn")?.addEventListener("click", () => {
    openAuthModal("sign-in to leave a comment");
  });

  const form = document.getElementById("gp-comment-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    void handlePostComment();
  });

  if (listEl) renderCommentList(listEl);
  bindDeleteAndLoadMore(body);
}

function bindDeleteAndLoadMore(container: HTMLElement): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const deleteBtn = target.closest<HTMLButtonElement>(".comment-delete-btn");
    if (deleteBtn) {
      const commentId = deleteBtn.dataset.commentId;
      if (!commentId) return;
      if (deleteBtn.dataset.modDelete === "1" && !window.confirm("Delete this comment as a moderator?")) return;
      void handleDeleteComment(commentId);
      return;
    }

    const reportBtn = target.closest<HTMLButtonElement>(".comment-report-btn");
    if (reportBtn && activeGame) {
      const commentId = reportBtn.dataset.commentId;
      const comment = comments.find((c) => c.id === commentId);
      if (comment) openCommentReportModal(comment, activeGame);
      return;
    }

    if (target.closest(".comments-load-more")) {
      void handleLoadMore();
    }
  });
}

async function handlePostComment(): Promise<void> {
  if (!activeUser || !activeGame || isPosting) return;

  const textarea = document.getElementById("comment-textarea") as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById("comment-submit-btn") as HTMLButtonElement | null;
  if (!textarea || !submitBtn) return;

  const body = textarea.value.trim();
  if (!body) {
    setPostStatus("Comment cannot be empty.", true);
    return;
  }
  if (body.length > COMMENT_MAX_LEN) {
    setPostStatus(`Comment must be ${COMMENT_MAX_LEN} characters or fewer.`, true);
    return;
  }

  const now = Date.now();
  if (now - lastPostTime < POST_COOLDOWN_MS) {
    const wait = Math.ceil((POST_COOLDOWN_MS - (now - lastPostTime)) / 1000);
    setPostStatus(`Please wait ${wait}s before posting again.`, true);
    return;
  }

  isPosting = true;
  submitBtn.disabled = true;
  setPostStatus(null);

  try {
    const comment = await postComment(activeUser, activeGame.title_id, body);
    lastPostTime = Date.now();
    textarea.value = "";
    updateCharCount(textarea);
    setPostStatus(null);

    if (comment) {
      comments = [comment, ...comments];
      const listEl = document.getElementById("gp-comments-list");
      if (listEl) renderCommentList(listEl);
      updateSectionHeading(comments.length);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to post comment.";
    setPostStatus(msg, true);
  } finally {
    isPosting = false;
    submitBtn.disabled = false;
  }
}

async function handleDeleteComment(commentId: string): Promise<void> {
  try {
    await deleteComment(commentId);
    comments = comments.filter((c) => c.id !== commentId);
    const listEl = document.getElementById("gp-comments-list");
    if (listEl) renderCommentList(listEl);
    updateSectionHeading(comments.length);
  } catch {
    // Non-critical — silently ignore
  }
}

async function handleLoadMore(): Promise<void> {
  if (!activeGame || isLoading || !hasMore) return;
  commentPage += 1;
  isLoading = true;
  const listEl = document.getElementById("gp-comments-list");
  if (listEl) renderCommentList(listEl);

  try {
    const next = await loadComments(activeGame.title_id, commentPage);
    hasMore = next.length === COMMENTS_PAGE_SIZE;
    comments = [...comments, ...next];
  } catch {
    commentPage -= 1;
  } finally {
    isLoading = false;
    if (listEl) renderCommentList(listEl);
  }
}

async function loadAndRenderComments(): Promise<void> {
  if (!activeGame) return;
  isLoading = true;
  const listEl = document.getElementById("gp-comments-list");
  if (listEl) renderCommentList(listEl);

  try {
    const data = await loadComments(activeGame.title_id, 0);
    comments = data;
    hasMore = data.length === COMMENTS_PAGE_SIZE;
    updateSectionHeading(comments.length);
  } catch {
    comments = [];
    hasMore = false;
  } finally {
    isLoading = false;
    if (listEl) renderCommentList(listEl);
  }
}

export function setActiveGameForComments(game: TitleEntry | null): void {
  activeGame = game;
  comments = [];
  commentPage = 0;
  hasMore = false;
  isLoading = false;
  isPosting = false;

  renderSection();

  if (game && isGameRelease(game)) {
    void loadAndRenderComments();
  }
}

export function bindCommentsUi(): void {
  onAuthChange((user) => {
    activeUser = user;
    if (activeGame) renderSection();
  });

  activeUser = getCurrentUser();
}
