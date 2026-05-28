/**
 * Cloudflare Worker: auth gate + IA link resolution (no full-file buffering).
 * GET /download?key=… → JSON { url } (stream link for Archive; direct URL for other hosts).
 * GET /download/file?key=… → stream bytes from Archive CDN using IA_COOKIE_POOL (Range-aware).
 *
 * wrangler secret put IA_COOKIE_POOL
 * wrangler secret put SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 */

import { buildIaCookieHeader, parseIaCookiePoolFromEnv, pickIaCookiePair } from "../../scripts/ia-cookie-pool.mjs";

let mapCache = { map: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;

const DEFAULT_HOSTS = "archive.org,vimm.net,file.romsworlds.com,1fichier.com";
const MAX_REDIRECTS = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const names = ["content-type", "content-disposition", "content-length", "accept-ranges", "content-range"];
  for (const n of names) {
    const v = upstream.headers.get(n);
    if (v) out.set(n, v);
  }
  return out;
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
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apiKey) return false;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: apiKey
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

function isArchiveHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "archive.org" || host.endsWith(".archive.org");
}

function iaCookieHeader(env) {
  const pool = parseIaCookiePoolFromEnv(env);
  const pair = pickIaCookiePair(pool);
  if (!pair) return null;
  const header = buildIaCookieHeader(pair);
  return header || null;
}

/**
 * Follow Archive redirects with a pool cookie; return the CDN/direct URL IA would serve.
 */
async function resolveArchiveDownloadUrl(archiveUrl, env) {
  const cookie = iaCookieHeader(env);
  if (!cookie) {
    return { url: archiveUrl.toString(), verified: false, reason: "no_pool" };
  }

  const headers = { Cookie: cookie, Range: "bytes=0-0" };
  let url = archiveUrl.toString();

  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    const res = await fetch(url, { redirect: "manual", headers });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      url = new URL(location, url).toString();
      continue;
    }
    if (res.ok || res.status === 206) {
      return { url, verified: true, reason: null };
    }
    return { url: archiveUrl.toString(), verified: false, reason: `upstream_${res.status}` };
  }

  return { url: archiveUrl.toString(), verified: false, reason: "redirect_loop" };
}

function buildFileDownloadUrl(reqUrl, key) {
  const fileUrl = new URL("/download/file", reqUrl.origin);
  fileUrl.searchParams.set("key", key);
  const token = reqUrl.searchParams.get("access_token");
  const guest = reqUrl.searchParams.get("guest");
  if (token) fileUrl.searchParams.set("access_token", token);
  if (guest) fileUrl.searchParams.set("guest", guest);
  return fileUrl.toString();
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

async function resolveClientDownloadUrl(target, env, reqUrl, key) {
  if (!isArchiveHost(target.hostname)) {
    return { url: target.toString(), mode: "direct" };
  }

  const pool = parseIaCookiePoolFromEnv(env);
  if (!pool.length) {
    return { url: target.toString(), mode: "catalog" };
  }

  const resolved = await resolveArchiveDownloadUrl(target, env);
  if (!resolved.verified) {
    return { url: target.toString(), mode: "catalog" };
  }

  // IA CDN URLs require logged-in cookies in the browser; hand off a Worker stream URL instead.
  return { url: buildFileDownloadUrl(reqUrl, key), mode: "stream", upstream: resolved.url };
}

async function handleDownloadFile(request, env, reqUrl, key, filenameMap, allowedHosts) {
  const target = parseTarget(filenameMap, key, allowedHosts);
  if (!target) {
    return jsonResponse(400, { error: "Invalid or unknown key" }, request);
  }

  if (!isArchiveHost(target.hostname)) {
    return Response.redirect(target.toString(), 302);
  }

  const cookie = iaCookieHeader(env);
  if (!cookie) {
    return jsonResponse(503, { error: "IA cookie pool not configured on worker" }, request);
  }

  const resolved = await resolveArchiveDownloadUrl(target, env);
  if (!resolved.verified) {
    return jsonResponse(502, { error: "Could not resolve Archive download URL" }, request);
  }

  const upstreamHeaders = { Cookie: cookie };
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(resolved.url, { redirect: "follow", headers: upstreamHeaders });
  const headers = passthroughHeaders(upstream);
  return new Response(upstream.body, { status: upstream.status, headers });
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

    if (path !== "/download" && path !== "/download/file") {
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

    if (path === "/download/file") {
      try {
        const allowed = await authorizeDownload(request, env, reqUrl, key);
        if (!allowed.ok) {
          return jsonResponse(allowed.status, { error: allowed.error }, request);
        }
      } catch (e) {
        return jsonResponse(500, { error: e instanceof Error ? e.message : "Authorization failed" }, request);
      }
      return handleDownloadFile(request, env, reqUrl, key, filenameMap, allowedHosts);
    }

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

    const resolved = await resolveClientDownloadUrl(target, env, reqUrl, key);
    return jsonResponse(200, { url: resolved.url, mode: resolved.mode }, request);
  }
};
