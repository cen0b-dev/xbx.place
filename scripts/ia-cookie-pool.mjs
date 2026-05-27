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
      decoded = Buffer.from(decoded, "base64").toString("utf8");
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

export function buildIaCookieHeader(pair) {
  const user = canonicalizeCookieValue(pair?.user);
  const sig = canonicalizeCookieValue(pair?.sig);
  if (!user || !sig) return "";
  return `logged-in-user=${user}; logged-in-sig=${sig};`;
}
