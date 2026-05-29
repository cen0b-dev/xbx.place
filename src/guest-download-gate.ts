import { discordCtaButtonMarkup } from "./discord";
import { openAuthModal } from "./auth-ui";

export type GuestGateReason = "active" | "signup";

function setGateCopy(reason: GuestGateReason, activeFilename?: string): void {
  const eyebrow = document.getElementById("guest-gate-eyebrow");
  const title = document.getElementById("guest-gate-title");
  const lead = document.getElementById("guest-gate-lead");
  const note = document.getElementById("guest-gate-note");

  if (reason === "active") {
    if (eyebrow) eyebrow.textContent = "Download in progress";
    if (title) title.textContent = "One download at a time";
    if (lead) {
      lead.textContent =
        "Guests can run one game download at a time. Finish your current download, then you can grab another — or create a free account to download without waiting.";
    }
    if (note) {
      const file = activeFilename?.trim();
      note.textContent = file ? `In progress: ${file}` : "Your current download is still active.";
      note.classList.remove("hidden");
    }
  } else {
    if (eyebrow) eyebrow.textContent = "Free account";
    if (title) title.textContent = "Unlock unlimited downloads";
    if (lead) {
      lead.textContent =
        "Create a free xbx.place account to download multiple games, save collections, and pick up where you left off on any device.";
    }
    if (note) note.classList.add("hidden");
  }
}

export function openGuestDownloadGate(reason: GuestGateReason, activeFilename?: string): void {
  setGateCopy(reason, activeFilename);
  document.getElementById("guestDownloadGate")?.classList.add("show");
}

export function closeGuestDownloadGate(): void {
  document.getElementById("guestDownloadGate")?.classList.remove("show");
}

export function guestDownloadGateMarkup(): string {
  return `
    <div class="overlay overlay--fit" id="guestDownloadGate" aria-hidden="true">
      <div class="game-modal game-modal--ambient game-modal--compact">
        <div class="game-modal-bg" aria-hidden="true">
          <img class="game-modal-bg-img" alt="" />
          <div class="game-modal-bg-shade"></div>
        </div>
        <div class="game-modal-page-shell">
          <button class="game-back-link" id="close-guest-gate" type="button" aria-label="Close">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i><span>Close</span>
          </button>
          <div class="game-modal-body guest-gate-body">
            <header class="game-modal-header">
              <div class="game-modal-eyebrow" id="guest-gate-eyebrow">Free account</div>
              <h2 class="game-modal-title" id="guest-gate-title">Unlock unlimited downloads</h2>
              <p class="game-modal-sub" id="guest-gate-lead"></p>
            </header>
            <section class="game-modal-section">
              <p id="guest-gate-note" class="guest-gate-note hidden" role="status"></p>
              <ul class="guest-gate-perks" aria-label="Account benefits">
                <li><i class="fa-solid fa-download" aria-hidden="true"></i> Multiple downloads at once</li>
                <li><i class="fa-solid fa-bookmark" aria-hidden="true"></i> Save games to collections</li>
                <li><i class="fa-solid fa-id-badge" aria-hidden="true"></i> Gamertag, gamerpic &amp; profile</li>
                <li><i class="fa-solid fa-cloud" aria-hidden="true"></i> Syncs across devices — always free</li>
              </ul>
            </section>
            <div class="game-modal-footer guest-gate-footer">
              <button class="btn guest-gate-primary" id="guest-gate-signup" type="button">Create free account</button>
              <button class="btn btn-ghost guest-gate-secondary" id="guest-gate-signin" type="button">Sign in</button>
              <div class="guest-gate-discord">${discordCtaButtonMarkup("Join our Discord", "btn btn-discord btn-discord--ghost")}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function bindGuestDownloadGateUi(): void {
  document.getElementById("close-guest-gate")?.addEventListener("click", () => closeGuestDownloadGate());
  document.getElementById("guestDownloadGate")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeGuestDownloadGate();
  });

  document.getElementById("guest-gate-signup")?.addEventListener("click", () => {
    closeGuestDownloadGate();
    openAuthModal("Create a free account to download without limits.", "sign-up");
  });

  document.getElementById("guest-gate-signin")?.addEventListener("click", () => {
    closeGuestDownloadGate();
    openAuthModal("Sign in to download without limits.", "sign-in");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("guestDownloadGate")?.classList.contains("show")) {
      closeGuestDownloadGate();
    }
  });
}
