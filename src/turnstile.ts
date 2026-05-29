/**
 * Cloudflare Turnstile helper for download ticket issuance.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          size?: "invisible" | "normal" | "compact";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          action?: string;
        }
      ) => string;
      execute: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;
let widgetId: string | null = null;
let containerEl: HTMLDivElement | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

export async function getTurnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null;

  await loadTurnstileScript();
  if (!window.turnstile) return null;

  if (!containerEl) {
    containerEl = document.createElement("div");
    containerEl.id = "xbx-turnstile";
    containerEl.style.display = "none";
    document.body.appendChild(containerEl);
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Turnstile timed out")), 15000);

    const finish = (token: string | null) => {
      window.clearTimeout(timeout);
      resolve(token);
    };

    if (widgetId) {
      window.turnstile!.remove(widgetId);
      widgetId = null;
    }

    widgetId = window.turnstile!.render(containerEl!, {
      sitekey: SITE_KEY,
      size: "invisible",
      action: "download",
      callback: (token) => finish(token),
      "error-callback": () => finish(null),
    });
    window.turnstile!.execute(widgetId);
  });
}
