import { gamePagePath } from "./seo-url";
import { getAccessToken } from "./auth";
import { syncGameModalBackground } from "./data";
import { dropdownMarkup, getDropdownValue, mountDropdown, setDropdownValue } from "./form-controls";
import { sanitizeReportDetails } from "./sanitize";
import type { GameComment } from "./comments";
import type { TitleEntry } from "./types";

export const COMMENT_REPORT_REASON_OPTIONS = [
  { value: "spam", label: "Spam or advertising" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "off_topic", label: "Off-topic or unrelated" },
  { value: "other", label: "Other" },
] as const;

let reportComment: GameComment | null = null;
let reportGame: TitleEntry | null = null;
let reportNoticeTimer = 0;

function showReportNotice(message: string, isError = false): void {
  let notice = document.getElementById("comment-report-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "comment-report-notice";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.className = isError ? "download-notice error show" : "download-notice show";
  window.clearTimeout(reportNoticeTimer);
  reportNoticeTimer = window.setTimeout(() => {
    notice?.classList.remove("show");
  }, 6000);
}

export function closeCommentReportModal(): void {
  document.getElementById("commentReportMod")?.classList.remove("show");
}

export function closeCommentReportUi(): void {
  closeCommentReportModal();
  reportComment = null;
  reportGame = null;
}

function gamePageUrl(game: TitleEntry): string {
  return new URL(gamePagePath(game.title_id), window.location.origin).toString();
}

export function openCommentReportModal(comment: GameComment, game: TitleEntry): void {
  reportComment = comment;
  reportGame = game;

  const subtitle = document.getElementById("comment-report-mod-subtitle");
  if (subtitle) subtitle.textContent = `Comment by ${comment.gamertag}`;

  syncGameModalBackground("commentReportMod", game);

  const details = document.getElementById("comment-report-details") as HTMLTextAreaElement | null;
  if (details) details.value = "";

  setDropdownValue("commentReportReason", "spam");

  const status = document.getElementById("comment-report-status");
  status?.classList.add("hidden");
  if (status) status.textContent = "";

  const submit = document.getElementById("comment-report-submit") as HTMLButtonElement | null;
  if (submit) submit.disabled = false;

  document.getElementById("commentReportMod")?.classList.add("show");
}

async function submitCommentReport(): Promise<void> {
  const comment = reportComment;
  const game = reportGame;
  if (!comment || !game) return;

  const reason = getDropdownValue("commentReportReason");
  if (!reason) {
    showReportNotice("Choose what kind of issue you are reporting.", true);
    return;
  }

  const detailsEl = document.getElementById("comment-report-details") as HTMLTextAreaElement | null;
  const details = sanitizeReportDetails(detailsEl?.value ?? "");

  const submit = document.getElementById("comment-report-submit") as HTMLButtonElement | null;
  const status = document.getElementById("comment-report-status");
  if (submit) submit.disabled = true;
  if (status) {
    status.textContent = "Sending report…";
    status.classList.remove("hidden");
  }

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

  if (!supabaseUrl || !supabaseKey) {
    showReportNotice("Reporting is not configured yet. Try again later.", true);
    if (submit) submit.disabled = false;
    status?.classList.add("hidden");
    return;
  }

  const token = (await getAccessToken()) ?? supabaseKey;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/report-comment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        comment_id: comment.id,
        title_id: game.title_id,
        title_name: game.name,
        reason,
        details,
        comment_excerpt: comment.body.slice(0, 280),
        page_url: gamePageUrl(game),
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Request failed (${res.status})`);
    }

    closeCommentReportModal();
    showReportNotice("Thanks — your report was sent to the team.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send report";
    showReportNotice(message, true);
    if (status) {
      status.textContent = message;
      status.classList.remove("hidden");
    }
  } finally {
    if (submit) submit.disabled = false;
  }
}

export function commentReportMarkup(): string {
  return `
    <div class="overlay overlay--fit" id="commentReportMod">
      <div class="game-modal game-modal--compact">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-comment-report-mod" type="button" aria-label="Close report form">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
            <header class="game-modal-header">
              <div class="game-modal-eyebrow">Report</div>
              <h2 class="game-modal-title">Report comment</h2>
              <p id="comment-report-mod-subtitle" class="game-modal-sub"></p>
            </header>
            <section class="game-modal-section">
              <p class="game-modal-lead">Flag spam, harassment, or off-topic comments. Reports go to the xbx.place team on Discord.</p>
              <div class="game-modal-panel game-modal-panel--stack">
                <form id="comment-report-form" class="report-form">
                  <div class="game-modal-field">
                    <span class="game-meta-label" id="comment-report-reason-label">What is wrong?</span>
                    ${dropdownMarkup("commentReportReason", [...COMMENT_REPORT_REASON_OPTIONS], "spam", "ui-dropdown--block")}
                  </div>
                  <div class="game-modal-field">
                    <label class="game-meta-label" for="comment-report-details">Details (optional)</label>
                    <textarea id="comment-report-details" class="inp report-details-inp" rows="4" maxlength="500" placeholder="Add context if helpful."></textarea>
                  </div>
                  <div id="comment-report-status" class="report-status hidden" role="status"></div>
                </form>
              </div>
            </section>
            <div class="game-modal-footer">
              <button class="btn game-modal-footer-primary" id="comment-report-submit" type="submit" form="comment-report-form">
                <i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>Send report</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindCommentReportUi(): void {
  mountDropdown("commentReportReason");

  document.getElementById("close-comment-report-mod")?.addEventListener("click", () => closeCommentReportModal());
  document.getElementById("commentReportMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCommentReportModal();
  });

  document.getElementById("comment-report-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCommentReport();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("commentReportMod")?.classList.contains("show")) {
      closeCommentReportModal();
    }
  });
}
