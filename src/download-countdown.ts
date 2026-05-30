export const GUEST_COUNTDOWN_SECONDS = 5;
export const SIGNED_IN_COUNTDOWN_SECONDS = 1;

let activeTimer = 0;
let activeResolve: ((value: boolean) => void) | null = null;
let activeRoot: HTMLElement | null = null;

function activeDownloadModalRoot(): HTMLElement | null {
  const downloadMod = document.getElementById("downloadMod");
  if (downloadMod?.classList.contains("show")) return downloadMod;
  const packageMod = document.getElementById("packageMod");
  if (packageMod?.classList.contains("show")) return packageMod;
  return downloadMod;
}

function modalBody(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".game-modal-body");
}

function countdownPanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".download-countdown");
}

function countdownNumber(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".download-countdown-num");
}

function countdownFile(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".download-countdown-file");
}

function setCountdownActive(root: HTMLElement | null, active: boolean): void {
  const body = root ? modalBody(root) : null;
  body?.classList.toggle("is-countdown-active", active);
}

function clearActiveCountdown(completed = false): void {
  window.clearInterval(activeTimer);
  activeTimer = 0;
  if (activeRoot) {
    const panel = countdownPanel(activeRoot);
    panel?.classList.add("hidden");
    panel?.setAttribute("aria-hidden", "true");
    setCountdownActive(activeRoot, false);
  }
  activeRoot = null;
  const resolve = activeResolve;
  activeResolve = null;
  resolve?.(completed);
}

export function cancelDownloadCountdown(): void {
  if (!activeResolve) return;
  clearActiveCountdown(false);
}

export function downloadCountdownPanelMarkup(): string {
  return `
    <div class="download-countdown hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Preparing download">
      <div class="download-countdown-stage">
        <div class="download-countdown-ring" aria-hidden="true">
          <svg class="download-countdown-svg" viewBox="0 0 120 120">
            <circle class="download-countdown-track" cx="60" cy="60" r="52"></circle>
            <circle class="download-countdown-progress" cx="60" cy="60" r="52"></circle>
          </svg>
          <span class="download-countdown-num">${GUEST_COUNTDOWN_SECONDS}</span>
        </div>
        <header class="download-countdown-header">
          <div class="game-modal-eyebrow">Download</div>
          <h3 class="game-modal-title download-countdown-title">Preparing your download</h3>
          <p class="download-countdown-lead">Your file starts in a few seconds.</p>
          <p class="download-countdown-file" aria-live="polite"></p>
        </header>
        <button class="btn btn-ghost download-countdown-cancel" type="button">Cancel</button>
      </div>
    </div>
  `;
}

export function bindDownloadCountdownUi(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(".download-countdown-cancel")) {
      event.preventDefault();
      cancelDownloadCountdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !activeResolve) return;
    cancelDownloadCountdown();
  });
}

export function runDownloadCountdown(
  filename: string,
  seconds: number = GUEST_COUNTDOWN_SECONDS
): Promise<boolean> {
  if (seconds <= 0) return Promise.resolve(true);
  if (activeResolve) cancelDownloadCountdown();

  const root = activeDownloadModalRoot();
  const panel = root ? countdownPanel(root) : null;
  if (!root || !panel) return Promise.resolve(true);

  const totalSeconds = Math.max(1, Math.floor(seconds));
  const numberEl = countdownNumber(root);
  const fileEl = countdownFile(root);
  const progressEl = root.querySelector<SVGCircleElement>(".download-countdown-progress");
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  if (progressEl) {
    progressEl.style.strokeDasharray = `${circumference}`;
    progressEl.style.strokeDashoffset = "0";
  }

  if (fileEl) fileEl.textContent = filename;
  if (numberEl) numberEl.textContent = String(totalSeconds);

  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  setCountdownActive(root, true);
  activeRoot = root;

  return new Promise((resolve) => {
    activeResolve = resolve;
    let remaining = totalSeconds;

    activeTimer = window.setInterval(() => {
      remaining -= 1;
      if (numberEl) numberEl.textContent = String(Math.max(remaining, 0));
      if (progressEl) {
        const elapsed = totalSeconds - remaining;
        const offset = circumference * (elapsed / totalSeconds);
        progressEl.style.strokeDashoffset = String(offset);
      }
      if (remaining <= 0) clearActiveCountdown(true);
    }, 1000);
  });
}
