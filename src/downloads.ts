import { getAccessToken } from "./auth";
import type { GuestGateReason } from "./guest-download-gate";
import { hasProxy, notifyEvent, pickNextProxy, pickProxy, reportProxyRateLimit } from "./proxy-pool";
import { getTurnstileToken, isTurnstileConfigured } from "./turnstile";

const GUEST_ID_KEY = "xbx_guest_id";
/** Legacy one-download flag — removed so guests can download again after each finishes. */
const GUEST_USED_LEGACY_KEY = "xbx_guest_dl_used";
const GUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

try {
  window.localStorage.removeItem(GUEST_USED_LEGACY_KEY);
} catch {
  /* private mode */
}

export type DownloadGateResult =
  | { status: "started" }
  | { status: "auth_required"; reason: GuestGateReason; activeFilename?: string }
  | { status: "blocked"; message: string; tryOtherWorkers?: boolean };

function getGuestId(): string {
  let id = window.localStorage.getItem(GUEST_ID_KEY);
  if (!id || !GUEST_ID_RE.test(id)) {
    id = crypto.randomUUID();
    window.localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

function startDownloadNavigation(url: string): void {
  window.location.assign(url);
}

function mapGuestAuthError(
  status: number,
  body: { error?: string; active_filename?: string }
): DownloadGateResult | null {
  if (status === 401 && body.error === "auth_required") {
    return { status: "auth_required", reason: "signup" };
  }
  if (status === 403 && (body.error === "guest_active" || body.error === "guest_limit")) {
    const activeFilename = typeof body.active_filename === "string" ? body.active_filename : undefined;
    return { status: "auth_required", reason: "active", activeFilename };
  }
  return null;
}

async function requestDownload(resolveUrl: string, filename: string): Promise<DownloadGateResult> {
  const token = await getAccessToken();
  const guestId = getGuestId();
  const url = new URL(resolveUrl, window.location.origin);
  url.searchParams.set("guest", guestId);

  const headers: Record<string, string> = {
    "X-Guest-Id": guestId,
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (isTurnstileConfigured()) {
    try {
      const turnstileToken = await getTurnstileToken();
      if (turnstileToken) {
        headers["CF-Turnstile-Response"] = turnstileToken;
        url.searchParams.set("turnstile_token", turnstileToken);
      }
    } catch {
      return { status: "blocked", message: "Security check failed. Please refresh and try again." };
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers, credentials: "omit", redirect: "manual" });
  } catch {
    return { status: "blocked", message: "Could not reach the download service.", tryOtherWorkers: true };
  }

  if (res.status === 302) {
    const location = res.headers.get("Location");
    if (!location) return { status: "blocked", message: "Download redirect missing." };
    startDownloadNavigation(location);
    return { status: "started" };
  }

  let body: { redirect?: string; url?: string; filename?: string; error?: string; active_filename?: string; retry_after?: number };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { status: "blocked", message: "Invalid response from the download service." };
  }

  if (!res.ok) {
    const auth = mapGuestAuthError(res.status, body);
    if (auth) return auth;
    if (res.status === 401) {
      return {
        status: "blocked",
        message: "Sign in, or allow this site to store a guest id (localStorage), then try again.",
        tryOtherWorkers: false,
      };
    }
    if (res.status === 403 && body.error === "turnstile_required") {
      return {
        status: "blocked",
        message: "Security verification required. Refresh the page and try again.",
        tryOtherWorkers: false,
      };
    }
    if (res.status === 429) {
      const wait = typeof body.retry_after === "number" ? body.retry_after : 60;
      return {
        status: "blocked",
        message: `Too many download attempts. Try again in ${wait} seconds.`,
        tryOtherWorkers: true,
      };
    }
    if (res.status === 503) notifyEvent("ia_cookie_empty", new URL(resolveUrl).origin, body.error);
    if (res.status === 502) notifyEvent("ia_resolve_failed", new URL(resolveUrl).origin, body.error);
    const tryOtherWorkers = res.status >= 500 || res.status === 429;
    return {
      status: "blocked",
      message: body.error ?? `Download unavailable (${res.status}).`,
      tryOtherWorkers,
    };
  }

  const redirectUrl = body.redirect ?? body.url;
  if (!redirectUrl) return { status: "blocked", message: "No download URL returned." };

  startDownloadNavigation(redirectUrl);
  return { status: "started" };
}

/**
 * Pick a healthy worker from the pool and request the download, failing over
 * to the next worker on transient errors.
 */
export async function requestDownloadWithPool(filename: string): Promise<DownloadGateResult> {
  const archiveFilename = filename.trim();
  if (!archiveFilename) {
    return { status: "blocked", message: "Missing download filename." };
  }

  if (!hasProxy()) {
    return { status: "blocked", message: "No download workers are configured. Please try again later." };
  }

  let origin = pickProxy();
  while (origin !== null) {
    const result = await requestDownload(
      `${origin}/download?filename=${encodeURIComponent(archiveFilename)}`,
      archiveFilename
    );

    if (result.status === "started" || result.status === "auth_required") return result;

    if (result.tryOtherWorkers !== false) {
      reportProxyRateLimit(origin, result.message);
    }
    if (result.tryOtherWorkers === false) {
      return result;
    }

    const next = pickNextProxy(origin);
    if (next === null) break;
    origin = next;
  }

  notifyEvent("all_workers_down");
  return { status: "blocked", message: "All download workers are currently unavailable. Please try again later." };
}
