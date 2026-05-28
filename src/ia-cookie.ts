export type IaCookiePair = { user: string; sig: string };

const STORAGE_KEY = "x_ia_cookie_pool";

function canonicalizeCookieValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n;\0]/.test(trimmed)) return null;
  try {
    return encodeURIComponent(decodeURIComponent(trimmed));
  } catch {
    return encodeURIComponent(trimmed);
  }
}

export function parseIaCookiePoolJson(raw: string): IaCookiePair[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const row = entry as { user?: string; sig?: string };
        const user = canonicalizeCookieValue(row?.user ?? "");
        const sig = canonicalizeCookieValue(row?.sig ?? "");
        if (!user || !sig) return null;
        return { user, sig };
      })
      .filter((row): row is IaCookiePair => row !== null);
  } catch {
    return [];
  }
}

function envPool(): IaCookiePair[] {
  const raw = import.meta.env.VITE_IA_COOKIE_POOL;
  return typeof raw === "string" ? parseIaCookiePoolJson(raw) : [];
}

export function getIaCookiePool(): IaCookiePair[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const fromStorage = stored ? parseIaCookiePoolJson(stored) : [];
    if (fromStorage.length) return fromStorage;
  } catch {
    // private mode
  }
  return envPool();
}

export function setIaCookiePool(raw: string): IaCookiePair[] {
  const pool = parseIaCookiePoolJson(raw);
  if (pool.length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pool));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  return pool;
}

export function pickIaCookiePair(): IaCookiePair | null {
  const pool = getIaCookiePool();
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** Bookmarklet: sets download session cookies in the browser (run once per profile). */
export function buildIaBookmarklet(pair: IaCookiePair): string {
  const user = pair.user.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const sig = pair.sig.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return (
    "javascript:(function(){" +
    "var d='.archive.org',p='/';" +
    `document.cookie='logged-in-user=${user};path='+p+';domain='+d+';secure;samesite=lax';` +
    `document.cookie='logged-in-sig=${sig};path='+p+';domain='+d+';secure;samesite=lax';` +
    "alert('Download session applied. Return to xbx.place and download.');" +
    "})();"
  );
}
