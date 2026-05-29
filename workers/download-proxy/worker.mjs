/**
 * Cloudflare Worker: IA auth gate + stream proxy.
 * GET /download?key=…      → JSON { url } pointing at /download/file
 * GET /download/file?key=… → stream bytes from IA CDN (Range-aware)
 *
 * wrangler secret put IA_COOKIE_POOL
 * wrangler secret put SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 */

import { buildIaCookieHeader, parseIaCookiePoolFromEnv, pickIaCookiePair } from "../../scripts/ia-cookie-pool.mjs";

let mapCache = { map: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// CORS / response helpers
// ---------------------------------------------------------------------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const out = new Headers();
  out.set("access-control-allow-origin", origin || "*");
  if (origin) out.set("vary", "Origin");
  out.set("access-control-allow-methods", "GET, OPTIONS");
  out.set("access-control-allow-headers", "Authorization, X-Guest-Id, Content-Type, Range");
  out.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition");
  return out;
}

function jsonResponse(status, obj, request) {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers });
}

function passthroughHeaders(upstream) {
  const out = new Headers();
  for (const n of ["content-type", "content-disposition", "content-length", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(n);
    if (v) out.set(n, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function readBearerToken(request, reqUrl) {
  const raw = request.headers.get("Authorization");
  if (raw?.startsWith("Bearer ")) {
    const token = raw.slice(7).trim();
    if (token) return token;
  }
  return reqUrl.searchParams.get("access_token")?.trim() || null;
}

function readGuestId(request, reqUrl) {
  const raw = request.headers.get("X-Guest-Id");
  if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
  const q = reqUrl.searchParams.get("guest")?.trim();
  return q && UUID_RE.test(q) ? q : null;
}

async function verifySupabaseUser(env, token) {
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !apiKey) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: apiKey }
  });
  return res.ok;
}

async function allowGuestDownload(env, guestId, filename) {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRole } = env;
  if (!url || !serviceRole) return { ok: true };

  const headers = { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` };

  const existing = await fetch(`${url}/rest/v1/guest_downloads?guest_id=eq.${guestId}&select=guest_id`, { headers });
  if (existing.status === 404) {
    console.warn("guest_downloads table missing; guest limits disabled.");
    return { ok: true };
  }
  if (!existing.ok) throw new Error(`guest lookup failed: ${existing.status}`);
  const rows = await existing.json();
  if (Array.isArray(rows) && rows.length > 0) return { ok: false, reason: "guest_limit" };

  const insert = await fetch(`${url}/rest/v1/guest_downloads`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ guest_id: guestId, filename })
  });
  if (insert.status === 404) {
    console.warn("guest_downloads table missing; guest limits disabled.");
    return { ok: true };
  }
  if (insert.status === 409) return { ok: false, reason: "guest_limit" };
  if (!insert.ok) throw new Error(`guest insert failed: ${insert.status}`);
  return { ok: true };
}

async function authorizeDownload(request, env, reqUrl, filename) {
  const token = readBearerToken(request, reqUrl);
  if (token && (await verifySupabaseUser(env, token))) return { ok: true };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: true };

  const guestId = readGuestId(request, reqUrl);
  if (!guestId) return { ok: false, status: 401, error: "auth_required" };

  try {
    const guest = await allowGuestDownload(env, guestId, filename);
    return guest.ok ? { ok: true } : { ok: false, status: 403, error: guest.reason };
  } catch (error) {
    console.warn("Guest download tracking unavailable; allowing download.", error);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// IA cookie pool + URL resolution
// ---------------------------------------------------------------------------

function iaCookieHeader(env) {
  const pool = parseIaCookiePoolFromEnv(env);
  const pair = pickIaCookiePair(pool);
  if (!pair) return null;
  return buildIaCookieHeader(pair) || null;
}

async function resolveIaUrl(archiveUrl, env) {
  const cookie = iaCookieHeader(env);
  if (!cookie) return { url: archiveUrl.toString(), verified: false };

  let url = archiveUrl.toString();
  const headers = { Cookie: cookie, Range: "bytes=0-0" };

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const res = await fetch(url, { redirect: "manual", headers });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      url = new URL(location, url).toString();
      continue;
    }
    if (res.ok || res.status === 206) return { url, verified: true };
    return { url: archiveUrl.toString(), verified: false };
  }

  return { url: archiveUrl.toString(), verified: false };
}

// ---------------------------------------------------------------------------
// Catalog index
// ---------------------------------------------------------------------------

async function getFilenameToUrlMap(env) {
  const now = Date.now();
  if (mapCache.map && now < mapCache.expiresAt) return mapCache.map;

  if (!env.MASTER_INDEX_URL) throw new Error("MASTER_INDEX_URL binding is required");
  const res = await fetch(env.MASTER_INDEX_URL);
  if (!res.ok) throw new Error(`master_index fetch ${res.status}`);

  const list = await res.json();
  const map = new Map();
  if (Array.isArray(list)) {
    for (const title of list) {
      for (const dl of Array.isArray(title?.downloads) ? title.downloads : []) {
        if (typeof dl?.filename === "string" && typeof dl?.url === "string") {
          map.set(dl.filename, dl.url);
        }
      }
    }
  }
  mapCache = { map, expiresAt: now + MAP_TTL_MS };
  return map;
}

function lookupUrl(filenameMap, key) {
  const raw = filenameMap.get(key);
  if (!raw) return null;
  try { return new URL(raw); } catch { return null; }
}

function buildFileDownloadUrl(reqUrl, key) {
  const url = new URL("/download/file", reqUrl.origin);
  url.searchParams.set("key", key);
  const token = reqUrl.searchParams.get("access_token");
  const guest = reqUrl.searchParams.get("guest");
  if (token) url.searchParams.set("access_token", token);
  if (guest) url.searchParams.set("guest", guest);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

    if (path !== "/download" && path !== "/download/file") {
      return jsonResponse(404, { error: "Not found" }, request);
    }

    const key = reqUrl.searchParams.get("key");
    if (!key) return jsonResponse(400, { error: "Missing key" }, request);

    try {
      const allowed = await authorizeDownload(request, env, reqUrl, key);
      if (!allowed.ok) return jsonResponse(allowed.status, { error: allowed.error }, request);
    } catch {
      return jsonResponse(500, { error: "Authorization failed" }, request);
    }

    let filenameMap;
    try {
      filenameMap = await getFilenameToUrlMap(env);
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Map load failed" }, request);
    }

    const archiveUrl = lookupUrl(filenameMap, key);
    if (!archiveUrl) return jsonResponse(400, { error: "Unknown file" }, request);

    if (path === "/download") {
      return jsonResponse(200, { url: buildFileDownloadUrl(reqUrl, key) }, request);
    }

    // /download/file — resolve IA CDN URL and stream
    const cookie = iaCookieHeader(env);
    if (!cookie) return jsonResponse(503, { error: "IA cookie pool not configured on worker" }, request);

    const resolved = await resolveIaUrl(archiveUrl, env);
    if (!resolved.verified) return jsonResponse(502, { error: "Could not resolve Archive download URL" }, request);

    const upstreamHeaders = { Cookie: cookie };
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(resolved.url, { redirect: "follow", headers: upstreamHeaders });
    return new Response(upstream.body, { status: upstream.status, headers: passthroughHeaders(upstream) });
  }
};
