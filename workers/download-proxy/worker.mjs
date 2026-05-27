/**
 * Cloudflare Workers (free tier): GET /download?key=<filename> → stream from allowlisted host.
 * Set MASTER_INDEX_URL to the public URL of master_index.json on GitHub Pages (same data the app ships).
 *
 * wrangler.toml: [vars] MASTER_INDEX_URL = "https://<user>.github.io/xbx.place/master_index.json"
 * wrangler secret put IA_COOKIE_POOL   # optional, one-line JSON array
 * Or [vars] IA_LOGGED_IN_USER / IA_LOGGED_IN_SIG for a single IA account (less ideal for git).
 */

let mapCache = { map: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;

const DEFAULT_HOSTS = "archive.org,vimm.net,file.romsworlds.com,1fichier.com";

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

function decodeBase64Rounds(raw, rounds) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const count = Number.isInteger(rounds) && rounds > 0 ? rounds : 1;
  let out = raw.trim();
  try {
    for (let i = 0; i < count; i += 1) {
      out = atob(out);
    }
    return out;
  } catch {
    return null;
  }
}

function getDecodeRounds(env) {
  const parsed = Number.parseInt(typeof env.IA_COOKIE_B64_ROUNDS === "string" ? env.IA_COOKIE_B64_ROUNDS : "1", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function parseAllowedHosts(raw) {
  const s = typeof raw === "string" && raw.trim() ? raw : DEFAULT_HOSTS;
  return s
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function parseIaCookiePool(env) {
  const rounds = getDecodeRounds(env);
  const decodedPool = decodeBase64Rounds(env.IA_COOKIE_POOL_B64, rounds);
  const poolJson =
    typeof env.IA_COOKIE_POOL === "string" && env.IA_COOKIE_POOL.trim()
      ? env.IA_COOKIE_POOL.trim()
      : typeof decodedPool === "string"
        ? decodedPool
        : "";
  if (poolJson) {
    try {
      const parsed = JSON.parse(poolJson);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((e) => {
          const user = canonicalizeCookieValue(e?.user);
          const sig = canonicalizeCookieValue(e?.sig);
          if (!user || !sig) return null;
          return { user, sig };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }
  const user = canonicalizeCookieValue(env.IA_LOGGED_IN_USER);
  const sig = canonicalizeCookieValue(env.IA_LOGGED_IN_SIG);
  if (user && sig) return [{ user, sig }];
  return [];
}

function pickIaPair(env) {
  const pool = parseIaCookiePool(env);
  if (!pool.length) return null;
  const i = Math.floor(Math.random() * pool.length);
  return pool[i] ?? null;
}

async function getFilenameToUrlMap(env) {
  const now = Date.now();
  if (mapCache.map && now < mapCache.expiresAt) {
    return mapCache.map;
  }
  const masterUrl = env.MASTER_INDEX_URL;
  if (!masterUrl || typeof masterUrl !== "string") {
    throw new Error("MASTER_INDEX_URL binding is required");
  }
  const res = await fetch(masterUrl);
  if (!res.ok) {
    throw new Error(`master_index fetch ${res.status}`);
  }
  const list = await res.json();
  const map = new Map();
  if (Array.isArray(list)) {
    for (const title of list) {
      const downloads = Array.isArray(title?.downloads) ? title.downloads : [];
      for (const dl of downloads) {
        if (typeof dl?.filename === "string" && typeof dl?.url === "string") {
          map.set(dl.filename, dl.url);
        }
      }
    }
  }
  mapCache = { map, expiresAt: now + MAP_TTL_MS };
  return map;
}

function parseTarget(filenameMap, key, allowedHosts) {
  const mapUrl = filenameMap.get(key);
  if (!mapUrl) return null;
  let parsed;
  try {
    parsed = new URL(mapUrl);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const ok = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? parsed : null;
}

function passthroughHeaders(upstream) {
  const out = new Headers();
  const names = ["content-type", "content-disposition", "content-length", "accept-ranges", "content-range"];
  for (const n of names) {
    const v = upstream.headers.get(n);
    if (v) out.set(n, v);
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" });
    }
    const reqUrl = new URL(request.url);
    if (reqUrl.pathname.replace(/\/$/, "") !== "/download") {
      return jsonResponse(404, { error: "Not found" });
    }
    const key = reqUrl.searchParams.get("key");
    if (!key) {
      return jsonResponse(400, { error: "Missing key" });
    }

    let filenameMap;
    try {
      filenameMap = await getFilenameToUrlMap(env);
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Map load failed" });
    }

    const allowedHosts = parseAllowedHosts(env.ALLOWED_DOWNLOAD_HOSTS);
    const target = parseTarget(filenameMap, key, allowedHosts);
    if (!target) {
      return jsonResponse(400, { error: "Invalid or unknown key" });
    }

    const upstreamHeaders = {};
    const range = request.headers.get("Range");
    if (range) {
      upstreamHeaders.Range = range;
    }
    if (target.hostname.toLowerCase().endsWith("archive.org")) {
      const pair = pickIaPair(env);
      if (pair) {
        upstreamHeaders.cookie = `logged-in-user=${pair.user}; logged-in-sig=${pair.sig};`;
      }
    }

    const upstream = await fetch(target.toString(), { redirect: "follow", headers: upstreamHeaders });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders(upstream)
    });
  }
};
