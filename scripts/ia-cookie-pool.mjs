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
