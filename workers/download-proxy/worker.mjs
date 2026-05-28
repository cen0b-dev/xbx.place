/**
 * Cloudflare Workers (free tier): GET /download?key=<filename> → stream from allowlisted host.
 * Set MASTER_INDEX_URL to the public URL of master_index.json on GitHub Pages (same data the app ships).
 *
 * wrangler.toml: [vars] MASTER_INDEX_URL = "https://<user>.github.io/xbx.place/master_index.json"
 * wrangler secret put IA_COOKIE_POOL   # optional, one-line JSON array
 * wrangler secret put IA_COOKIE_POOL_B64  # optional base64(JSON), optionally multi-round with IA_COOKIE_B64_ROUNDS
 * Or [vars] IA_LOGGED_IN_USER / IA_LOGGED_IN_SIG for a single IA account (less ideal for git).
 */

let mapCache = { map: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;

const DEFAULT_HOSTS = "archive.org,vimm.net,file.romsworlds.com,1fichier.com";
const DEFAULT_IMAGE_HOSTS = "download.xbox.com";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const out = new Headers();
  out.set("access-control-allow-origin", origin || "*");
  if (origin) out.set("vary", "Origin");
  out.set("access-control-allow-methods", "GET, OPTIONS");
  out.set("access-control-allow-headers", "Authorization, X-Guest-Id, Content-Type");
  return out;
}

function jsonResponse(status, obj, request) {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers });
}

function readBearerToken(request) {
  const raw = request.headers.get("Authorization");
  if (!raw || !raw.startsWith("Bearer ")) return null;
  const token = raw.slice("Bearer ".length).trim();
  return token || null;
}

function readGuestId(request) {
  const raw = request.headers.get("X-Guest-Id");
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

async function verifySupabaseUser(env, token) {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey
    }
  });
  return res.ok;
}

async function allowGuestDownload(env, guestId, filename) {
  const url = env.SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return { ok: true };

  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`
  };

  const existing = await fetch(`${url}/rest/v1/guest_downloads?guest_id=eq.${guestId}&select=guest_id`, { headers });
  if (existing.status === 404) {
    console.warn("guest_downloads table is missing in Supabase; guest limits disabled.");
    return { ok: true };
  }
  if (!existing.ok) {
    throw new Error(`guest lookup failed: ${existing.status}`);
  }
  const rows = await existing.json();
  if (Array.isArray(rows) && rows.length > 0) {
    return { ok: false, reason: "guest_limit" };
  }

  const insert = await fetch(`${url}/rest/v1/guest_downloads`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ guest_id: guestId, filename })
  });
  if (insert.status === 404) {
    console.warn("guest_downloads table is missing in Supabase; guest limits disabled.");
    return { ok: true };
  }
  if (insert.status === 409) {
    return { ok: false, reason: "guest_limit" };
  }
  if (!insert.ok) {
    throw new Error(`guest insert failed: ${insert.status}`);
  }
  return { ok: true };
}

async function authorizeDownload(request, env, filename) {
  const token = readBearerToken(request);
  if (token && (await verifySupabaseUser(env, token))) {
    return { ok: true };
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true };
  }

  const guestId = readGuestId(request);
  if (!guestId) {
    return { ok: false, status: 401, error: "auth_required" };
  }

  try {
    const guest = await allowGuestDownload(env, guestId, filename);
    if (!guest.ok) {
      return { ok: false, status: 403, error: guest.reason };
    }
    return { ok: true };
  } catch (error) {
    console.warn("Guest download tracking unavailable; allowing download.", error);
    return { ok: true };
  }
}

function parseAllowedHosts(raw) {
  const s = typeof raw === "string" && raw.trim() ? raw : DEFAULT_HOSTS;
  return s
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function parseAllowedImageHosts(raw) {
  const s = typeof raw === "string" && raw.trim() ? raw : DEFAULT_IMAGE_HOSTS;
  return s
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function parseImageTarget(rawUrl, allowedHosts) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return isAllowedHost(parsed.hostname, allowedHosts) ? parsed : null;
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
  const ok = isAllowedHost(host, allowedHosts);
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
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" }, request);
    }
    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname.replace(/\/$/, "");

    if (path === "/image") {
      const rawUrl = reqUrl.searchParams.get("url");
      const target = parseImageTarget(rawUrl, parseAllowedImageHosts(env.ALLOWED_IMAGE_HOSTS));
      if (!target) {
        return jsonResponse(400, { error: "Invalid or disallowed image url" }, request);
      }
      const upstream = await fetch(target.toString(), { redirect: "follow" });
      const headers = passthroughHeaders(upstream);
      headers.set("cache-control", "public, max-age=86400");
      for (const [name, value] of corsHeaders(request).entries()) {
        headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    if (path !== "/download") {
      return jsonResponse(404, { error: "Not found" }, request);
    }
    const key = reqUrl.searchParams.get("key");
    if (!key) {
      return jsonResponse(400, { error: "Missing key" }, request);
    }

    let filenameMap;
    try {
      filenameMap = await getFilenameToUrlMap(env);
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Map load failed" }, request);
    }

    const allowedHosts = parseAllowedHosts(env.ALLOWED_DOWNLOAD_HOSTS);
    const target = parseTarget(filenameMap, key, allowedHosts);
    if (!target) {
      return jsonResponse(400, { error: "Invalid or unknown key" }, request);
    }

    try {
      const allowed = await authorizeDownload(request, env, key);
      if (!allowed.ok) {
        return jsonResponse(allowed.status, { error: allowed.error }, request);
      }
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Authorization failed" }, request);
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
    const headers = passthroughHeaders(upstream);
    for (const [name, value] of corsHeaders(request).entries()) {
      headers.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  }
};
