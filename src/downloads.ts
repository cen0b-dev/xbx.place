import { getAccessToken, isAuthenticated } from "./auth";
import { hasProxy, notifyEvent, pickNextProxy, pickProxy, reportProxyRateLimit } from "./proxy-pool";

const GUEST_ID_KEY = "xbx_guest_id";
const GUEST_USED_KEY = "xbx_guest_dl_used";
const GUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DownloadGateResult =
  | { status: "started" }
  | { status: "auth_required" }
  | { status: "blocked"; message: string };

export function getGuestId(): string {
  let id = window.localStorage.getItem(GUEST_ID_KEY);
  if (!id || !GUEST_ID_RE.test(id)) {
    id = crypto.randomUUID();
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

async function requestDownload(resolveUrl: string): Promise<DownloadGateResult> {
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
    if (res.status === 401 && body.error === "auth_required") return { status: "auth_required" };
    if (res.status === 403 && body.error === "guest_limit") return { status: "auth_required" };
    if (res.status === 401) {
      return { status: "blocked", message: "Sign in, or allow this site to store a guest id (localStorage), then try again." };
    }
    // Surface IA-specific failures so the pool can report them distinctly
    if (res.status === 503) notifyEvent("ia_cookie_empty", new URL(resolveUrl).origin, body.error);
    if (res.status === 502) notifyEvent("ia_resolve_failed", new URL(resolveUrl).origin, body.error);
    return { status: "blocked", message: body.error ?? `Download unavailable (${res.status}).` };
  }

  if (!body.url) return { status: "blocked", message: "No download URL returned." };

  triggerNativeDownload(body.url);

  if (!isAuthenticated()) markGuestDownloadUsed();

  return { status: "started" };
}

/**
 * Pick a healthy worker from the pool and request the download, failing over
 * to the next worker on transient errors.
 */
export async function requestDownloadWithPool(filename: string): Promise<DownloadGateResult> {
  if (!hasProxy()) {
    return { status: "blocked", message: "No download workers are configured. Please try again later." };
  }

  let origin = pickProxy();
  while (origin !== null) {
    const result = await requestDownload(`${origin}/download?key=${encodeURIComponent(filename)}`);

    if (result.status === "started" || result.status === "auth_required") return result;

    reportProxyRateLimit(origin);
    const next = pickNextProxy(origin);
    if (next === null) break;
    origin = next;
  }

  notifyEvent("all_workers_down");
  return { status: "blocked", message: "All download workers are currently unavailable. Please try again later." };
}
