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

function triggerNativeDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function requestDownload(
  resolveUrl: string,
  _filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadGateResult> {
  if (!isAuthenticated() && guestDownloadUsedLocally()) {
    return { status: "auth_required" };
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    headers["X-Guest-Id"] = getGuestId();
  }

  onProgress?.({ loaded: 0, total: 0 });

  let res: Response;
  try {
    res = await fetch(resolveUrl, { headers, credentials: "omit" });
  } catch {
    return { status: "blocked", message: "Could not reach the download service." };
  }

  let body: { url?: string; error?: string };
  try {
    body = (await res.json()) as { url?: string; error?: string };
  } catch {
    return { status: "blocked", message: "Invalid response from the download service." };
  }

  if (!res.ok) {
    if (res.status === 401 && body.error === "auth_required") {
      return { status: "auth_required" };
    }
    if (res.status === 403 && body.error === "guest_limit") {
      return { status: "auth_required" };
    }
    return {
      status: "blocked",
      message: body.error ?? `Download unavailable (${res.status}).`
    };
  }

  if (!body.url) {
    return { status: "blocked", message: "No download URL returned." };
  }

  triggerNativeDownload(body.url);

  if (!isAuthenticated()) {
    markGuestDownloadUsed();
  }

  return { status: "started" };
}

export function formatDownloadProgress(_progress: DownloadProgress): string {
  return "Download started. Open your browser downloads (Chrome: ⌘+Shift+J). Large X360 files can take a while to appear.";
}
