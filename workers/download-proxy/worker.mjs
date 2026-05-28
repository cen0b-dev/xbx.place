/**
 * Cloudflare Worker: auth gate + URL resolution (no ROM byte proxy).
 * GET /download?key=<filename> → JSON { url } after allowlist + Supabase/guest checks.
 *
 * wrangler.toml: [vars] MASTER_INDEX_URL = "https://xbx.place/master_index.json"
 */

let mapCache = { map: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;

const DEFAULT_HOSTS = "archive.org,vimm.net,file.romsworlds.com,1fichier.com";

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

function readBearerToken(request, reqUrl) {
  const raw = request.headers.get("Authorization");
  if (raw && raw.startsWith("Bearer ")) {
    const token = raw.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const fromQuery = reqUrl.searchParams.get("access_token")?.trim();
  return fromQuery || null;
}

function readGuestId(request, reqUrl) {
  const raw = request.headers.get("X-Guest-Id");
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (UUID_RE.test(trimmed)) return trimmed;
  }
  const fromQuery = reqUrl.searchParams.get("guest")?.trim();
  return fromQuery && UUID_RE.test(fromQuery) ? fromQuery : null;
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

async function authorizeDownload(request, env, reqUrl, filename) {
  const token = readBearerToken(request, reqUrl);
  if (token && (await verifySupabaseUser(env, token))) {
    return { ok: true };
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true };
  }

  const guestId = readGuestId(request, reqUrl);
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

function isAllowedHost(hostname, allowedHosts) {
  const host = hostname.toLowerCase();
  return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
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
      const allowed = await authorizeDownload(request, env, reqUrl, key);
      if (!allowed.ok) {
        return jsonResponse(allowed.status, { error: allowed.error }, request);
      }
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Authorization failed" }, request);
    }

    return jsonResponse(200, { url: target.toString() }, request);
  }
};
