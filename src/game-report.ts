import { gamePagePath } from "./seo-url";
import { syncGameModalBackground } from "./data";
import { formatDownloadDisplay } from "./download-label";
import { dropdownMarkup, getDropdownValue, mountDropdown, setDropdownValue } from "./form-controls";
import { sanitizeReportDetails } from "./sanitize";
import type { TitleEntry } from "./types";

export const REPORT_REASON_OPTIONS = [
  { value: "broken_download", label: "Broken or failed download" },
  { value: "wrong_game", label: "Wrong game / mismatched files" },
  { value: "missing_files", label: "Missing DLC, updates, or files" },
  { value: "bad_metadata", label: "Wrong title, cover, or description" },
  { value: "other", label: "Other issue" },
] as const;

let reportGame: TitleEntry | null = null;
let reportNoticeTimer = 0;

function showReportNotice(message: string, isError = false): void {
  let notice = document.getElementById("report-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "report-notice";
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

function closeGameOptionsMenu(): void {
  document.getElementById("gp-options-menu")?.classList.add("hidden");
  document.getElementById("gp-details-btn")?.classList.remove("is-open");
}

export function closeReportModal(): void {
  document.getElementById("reportMod")?.classList.remove("show");
}

export function closeGameReportUi(): void {
  closeGameOptionsMenu();
  closeReportModal();
  reportGame = null;
}

function gamePageUrl(game: TitleEntry): string {
  return new URL(gamePagePath(game.title_id), window.location.origin).toString();
}

function fileOptionsForGame(game: TitleEntry): Array<{ value: string; label: string }> {
  const options = [{ value: "", label: "Not specific to one file" }];
  for (const file of game.downloads) {
    const display = formatDownloadDisplay(file.label ?? file.filename);
    const label = display.meta ? `${display.title} — ${display.meta}` : display.title;
    options.push({ value: label.slice(0, 200), label: label.slice(0, 120) });
  }
  return options;
}

function renderReportFileDropdown(game: TitleEntry): void {
  const host = document.getElementById("report-file-dropdown");
  if (!host) return;
  const options = fileOptionsForGame(game);
  host.innerHTML = dropdownMarkup("reportFile", options, "", "ui-dropdown--block");
  mountDropdown("reportFile");
}

export function openReportModal(game: TitleEntry): void {
  closeGameOptionsMenu();
  reportGame = game;
  const subtitle = document.getElementById("report-mod-subtitle");
  if (subtitle) subtitle.textContent = game.name;
  syncGameModalBackground("reportMod", game);

  const details = document.getElementById("report-details") as HTMLTextAreaElement | null;
  if (details) details.value = "";

  setDropdownValue("reportReason", "broken_download");
  renderReportFileDropdown(game);

  const status = document.getElementById("report-status");
  status?.classList.add("hidden");
  if (status) status.textContent = "";

  const submit = document.getElementById("report-submit") as HTMLButtonElement | null;
  if (submit) submit.disabled = false;

  document.getElementById("reportMod")?.classList.add("show");
}

async function submitGameReport(): Promise<void> {
  const game = reportGame;
  if (!game) return;

  const reason = getDropdownValue("reportReason");
  if (!reason) {
    showReportNotice("Choose what kind of issue you are reporting.", true);
    return;
  }

  const detailsEl = document.getElementById("report-details") as HTMLTextAreaElement | null;
  const details = sanitizeReportDetails(detailsEl?.value ?? "");
  const fileLabel = getDropdownValue("reportFile") || null;

  const submit = document.getElementById("report-submit") as HTMLButtonElement | null;
  const status = document.getElementById("report-status");
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

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/report-game`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        title_id: game.title_id,
        title_name: game.name,
        reason,
        details,
        file_label: fileLabel,
        page_url: gamePageUrl(game),
      }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Request failed (${res.status})`);
    }

    closeReportModal();
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

function toggleGameOptionsMenu(): void {
  const menu = document.getElementById("gp-options-menu");
  const btn = document.getElementById("gp-details-btn");
  if (!menu || !btn) return;
  const open = menu.classList.contains("hidden");
  if (open) {
    menu.classList.remove("hidden");
    btn.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
  } else {
    closeGameOptionsMenu();
    btn.setAttribute("aria-expanded", "false");
  }
}

export function gameReportMarkup(): string {
  return `
    <div class="overlay overlay--fit" id="reportMod">
      <div class="game-modal game-modal--compact">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-report-mod" type="button" aria-label="Close report form">
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span>
          </button>
          <div class="game-modal-body game-modal-body--narrow">
            <header class="game-modal-header">
              <div class="game-modal-eyebrow">Report</div>
              <h2 class="game-modal-title">Report an issue</h2>
              <p id="report-mod-subtitle" class="game-modal-sub"></p>
            </header>
            <section class="game-modal-section">
              <p class="game-modal-lead">Flag broken downloads, wrong files, missing packages, or bad metadata. Reports go to the xbx.place team on Discord.</p>
              <div class="game-modal-panel game-modal-panel--stack">
                <form id="report-form" class="report-form">
                  <div class="game-modal-field">
                    <span class="game-meta-label" id="report-reason-label">What is wrong?</span>
                    ${dropdownMarkup("reportReason", [...REPORT_REASON_OPTIONS], "broken_download", "ui-dropdown--block")}
                  </div>
                  <div class="game-modal-field">
                    <span class="game-meta-label" id="report-file-label">Related file (optional)</span>
                    <div id="report-file-dropdown"></div>
                  </div>
                  <div class="game-modal-field">
                    <label class="game-meta-label" for="report-details">Details (optional)</label>
                    <textarea id="report-details" class="inp report-details-inp" rows="4" maxlength="500" placeholder="What happened? Include region, file name, or steps if helpful."></textarea>
                  </div>
                  <div id="report-status" class="report-status hidden" role="status"></div>
                </form>
              </div>
            </section>
            <div class="game-modal-footer">
              <button class="btn game-modal-footer-primary" id="report-submit" type="submit" form="report-form">
                <i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>Send report</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindGameReportUi(getActiveGame: () => TitleEntry | null): void {
  mountDropdown("reportReason");

  document.getElementById("gp-details-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!getActiveGame()) return;
    toggleGameOptionsMenu();
  });

  document.getElementById("gp-report-btn")?.addEventListener("click", () => {
    const game = getActiveGame();
    if (!game) return;
    openReportModal(game);
  });

  document.getElementById("close-report-mod")?.addEventListener("click", () => closeReportModal());
  document.getElementById("reportMod")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeReportModal();
  });

  document.getElementById("report-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitGameReport();
  });

  document.addEventListener("click", (event) => {
    const menu = document.getElementById("gp-options-menu");
    const btn = document.getElementById("gp-details-btn");
    if (!menu || menu.classList.contains("hidden")) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (btn?.contains(target) || menu.contains(target)) return;
    closeGameOptionsMenu();
    btn?.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("reportMod")?.classList.contains("show")) {
      closeReportModal();
      return;
    }
    closeGameOptionsMenu();
    document.getElementById("gp-details-btn")?.setAttribute("aria-expanded", "false");
  });
}
