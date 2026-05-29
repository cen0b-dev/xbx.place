function canonicalizeCookieValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\r\n;\0]/.test(trimmed)) return null;
  try {
    return encodeURIComponent(decodeURIComponent(trimmed));
  } catch {
    return encodeURIComponent(trimmed);
  }
}

export function decodeBase64Rounds(raw, rounds = 1) {
  if (typeof raw !== "string") return null;
  let decoded = raw.trim();
  if (!decoded) return null;
  const count = Number.isInteger(rounds) && rounds > 0 ? rounds : 1;
  try {
    for (let i = 0; i < count; i += 1) {
      decoded =
        typeof Buffer !== "undefined"
          ? Buffer.from(decoded, "base64").toString("utf8")
          : atob(decoded);
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Parse IA cookie pool from env: JSON array of { user, sig }.
 * Values are canonicalized for cookie-header safety.
 */
export function parseIaCookiePoolJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const user = canonicalizeCookieValue(entry?.user);
        const sig = canonicalizeCookieValue(entry?.sig);
        if (!user || !sig) return null;
        return { user, sig };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function pickIaCookiePair(pool) {
  if (!Array.isArray(pool) || !pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function parseIaCookiePoolFromEnv(env) {
  const rounds = Number.parseInt(env?.IA_COOKIE_B64_ROUNDS ?? "1", 10);
  const decodedPool = decodeBase64Rounds(env?.IA_COOKIE_POOL_B64, rounds);
  const poolJson =
    typeof env?.IA_COOKIE_POOL === "string" && env.IA_COOKIE_POOL.trim()
      ? env.IA_COOKIE_POOL.trim()
      : typeof decodedPool === "string"
        ? decodedPool
        : "";
  if (poolJson) return parseIaCookiePoolJson(poolJson);
  const user = env?.IA_LOGGED_IN_USER;
  const sig = env?.IA_LOGGED_IN_SIG;
  if (typeof user === "string" && typeof sig === "string") {
    const parsed = parseIaCookiePoolJson(JSON.stringify([{ user, sig }]));
    if (parsed.length) return parsed;
  }
  return [];
}

export function buildIaCookieHeader(pair) {
  const user = canonicalizeCookieValue(pair?.user);
  const sig = canonicalizeCookieValue(pair?.sig);
  if (!user || !sig) return "";
  return `logged-in-user=${user}; logged-in-sig=${sig};`;
}

function decodeCookieLabel(userValue) {
  try {
    return decodeURIComponent(userValue);
  } catch {
    return userValue;
  }
}

function parseSigExpiry(sigRaw) {
  if (typeof sigRaw !== "string" || !sigRaw.trim()) return null;
  try {
    const decoded = decodeURIComponent(sigRaw.trim());
    const first = decoded.split(/\s+/)[0];
    const ts = Number.parseInt(first, 10);
    if (Number.isFinite(ts) && ts > 1_000_000_000) {
      return new Date(ts * 1000).toISOString();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Parse a browser cookie export (Chrome/Firefox extension JSON array)
 * into { user, sig, label, expiresAt }.
 */
export function parseBrowserCookieExport(raw) {
  let cookies;
  if (typeof raw === "string") {
    try {
      cookies = JSON.parse(raw);
    } catch {
      return null;
    }
  } else if (Array.isArray(raw)) {
    cookies = raw;
  } else {
    return null;
  }
  if (!Array.isArray(cookies)) return null;

  let userRaw = null;
  let sigRaw = null;
  for (const entry of cookies) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.name === "logged-in-user") userRaw = entry.value;
    if (entry.name === "logged-in-sig") sigRaw = entry.value;
  }

  const user = canonicalizeCookieValue(userRaw);
  const sig = canonicalizeCookieValue(sigRaw);
  if (!user || !sig) return null;

  return {
    user,
    sig,
    label: decodeCookieLabel(user),
    expiresAt: parseSigExpiry(sigRaw ?? sig),
  };
}

/**
 * Accept browser export JSON or a single { user, sig } pool entry.
 */
export function parseCookieInput(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;

  const fromBrowser = parseBrowserCookieExport(trimmed);
  if (fromBrowser) return fromBrowser;

  const pool = parseIaCookiePoolJson(trimmed);
  if (pool.length === 1) {
    const { user, sig } = pool[0];
    return { user, sig, label: decodeCookieLabel(user), expiresAt: parseSigExpiry(sig) };
  }

  return null;
}

/** Fetch enabled cookie pairs from Supabase ia_cookie_pool (service role). */
export async function fetchIaCookiePoolFromSupabase(supabaseUrl, serviceKey) {
  const url = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (serviceKey ?? "").trim();
  if (!url || !key) return [];

  const res = await fetch(
    `${url}/rest/v1/ia_cookie_pool?enabled=eq.true&select=id,user_value,sig_value&order=created_at.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return [];

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const user = canonicalizeCookieValue(row?.user_value);
      const sig = canonicalizeCookieValue(row?.sig_value);
      if (!user || !sig) return null;
      return { id: row.id, user, sig };
    })
    .filter(Boolean);
}

/** Stable IA file used to probe whether a session can reach the CDN. */
export const IA_VALIDATION_TEST_URL =
  "https://archive.org/download/microsoft_xbox360_a_part1/A%20Ressha%20de%20Ikou%20HX%20(Japan).zip";

const IA_VALIDATION_MAX_REDIRECTS = 8;

/** Returns whether logged-in-user/sig can resolve an Archive download (206/200 on CDN). */
export async function validateIaCookieSession(user, sig, testUrl = IA_VALIDATION_TEST_URL) {
  const cookie = buildIaCookieHeader({ user, sig });
  if (!cookie) return { valid: false, message: "Missing cookie values" };

  let url = testUrl;
  const headers = { Cookie: cookie, Range: "bytes=0-0" };

  try {
    for (let hop = 0; hop < IA_VALIDATION_MAX_REDIRECTS; hop++) {
      const res = await fetch(url, { redirect: "manual", headers });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        url = new URL(location, url).toString();
        continue;
      }
      if (res.ok || res.status === 206) return { valid: true, message: null };
      if (res.status === 401 || res.status === 403) {
        return { valid: false, message: `HTTP ${res.status} — session rejected` };
      }
      return { valid: false, message: `HTTP ${res.status}` };
    }
    return { valid: false, message: "Could not resolve Archive download URL" };
  } catch (err) {
    return { valid: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

/** Fire-and-forget usage log for a cookie (service role RPC). */
export function recordIaCookieUse(supabaseUrl, serviceKey, cookieId, outcome = "ok") {
  const url = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (serviceKey ?? "").trim();
  if (!url || !key || !cookieId) return;

  fetch(`${url}/rest/v1/rpc/record_ia_cookie_use`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ p_cookie_id: cookieId, p_outcome: outcome }),
  }).catch(() => {});
}
