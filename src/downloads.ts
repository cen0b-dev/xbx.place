import { getAccessToken, isAuthenticated } from "./auth";

const GUEST_ID_KEY = "xbx_guest_id";
const GUEST_USED_KEY = "xbx_guest_dl_used";

export type DownloadGateResult =
  | { status: "started" }
  | { status: "auth_required" }
  | { status: "blocked"; message: string };

export type DownloadProgress = {
  loaded: number;
  total: number;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getGuestId(): string {
  let id = window.localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = randomId();
    window.localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

export function guestDownloadUsedLocally(): boolean {
  return window.localStorage.getItem(GUEST_USED_KEY) === "1";
}

function markGuestDownloadUsed(): void {
  window.localStorage.setItem(GUEST_USED_KEY, "1");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 100 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

function triggerNativeDownload(url: string): void {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 120_000);
}

export function canStartDownloadWithoutAuth(): boolean {
  if (isAuthenticated()) return true;
  return !guestDownloadUsedLocally();
}

export async function requestDownload(
  targetUrl: string,
  _filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadGateResult> {
  if (!isAuthenticated() && guestDownloadUsedLocally()) {
    return { status: "auth_required" };
  }

  const token = await getAccessToken();
  const nativeUrl = new URL(targetUrl, window.location.origin);
  if (token) {
    nativeUrl.searchParams.set("access_token", token);
  } else {
    nativeUrl.searchParams.set("guest", getGuestId());
  }

  onProgress?.({ loaded: 0, total: 0 });
  triggerNativeDownload(nativeUrl.toString());

  if (!isAuthenticated()) {
    markGuestDownloadUsed();
  }

  return { status: "started" };
}

export function formatDownloadProgress(_progress: DownloadProgress): string {
  return "Download started. Open your browser downloads (Chrome: ⌘+Shift+J). Large X360 files can take a while to appear.";
}
