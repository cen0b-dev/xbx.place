import { getAccessToken, isAuthenticated } from "./auth";

const GUEST_ID_KEY = "xbx_guest_id";
const GUEST_USED_KEY = "xbx_guest_dl_used";
const GUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (typeof crypto === "undefined" || !("getRandomValues" in crypto)) {
    throw new Error("Secure random id unavailable in this browser.");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getGuestId(): string {
  let id = window.localStorage.getItem(GUEST_ID_KEY);
  if (!id || !GUEST_ID_RE.test(id)) {
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
  const guestId = getGuestId();
  const url = new URL(resolveUrl, window.location.origin);
  url.searchParams.set("guest", guestId);
  const headers: Record<string, string> = { "X-Guest-Id": guestId };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    url.searchParams.set("access_token", token);
  }

  onProgress?.({ loaded: 0, total: 0 });

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers, credentials: "omit" });
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
    if (res.status === 401) {
      return {
        status: "blocked",
        message: "Sign in, or allow this site to store a guest id (localStorage), then try again."
      };
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
