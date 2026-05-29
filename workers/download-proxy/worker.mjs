/**
 * Cloudflare Worker: IA auth gate + stream proxy.
 * GET /download?filename=… → 302 redirect to /download/file?ticket=…
 * GET /download/file?filename=…&ticket=… → stream bytes from IA CDN (Range-aware)
 *
 * wrangler secret put SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 * wrangler secret put DOWNLOAD_SIGNING_SECRET / TURNSTILE_SECRET_KEY
 */

import {
  buildIaCookieHeader,
  fetchIaCookiePoolFromSupabase,
  pickIaCookiePair,
  recordIaCookieUse,
} from "../../scripts/ia-cookie-pool.mjs";
import {
  HONEYPOT_MARKER,
  blockIp,
  botScore,
  buildLogContext,
  buildTicketDownloadUrl,
  checkIdentityRateLimit,
  checkIpBlocked,
  checkIpRateLimit,
  corsHeaders,
  createDownloadTicket,
  logDownloadAttempt,
  rateLimitResponse,
  trackGuestFingerprint,
  verifyDownloadTicket,
  verifyTurnstile,
} from "./security.mjs";

let mapCache = { map: null, expiresAt: 0 };
let cookiePoolCache = { pool: null, expiresAt: 0 };
const MAP_TTL_MS = 5 * 60 * 1000;
const COOKIE_POOL_TTL_MS = 60 * 1000;
const MAX_REDIRECTS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_ACTIVE_STALE_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(status, obj, request, env) {
  const headers = corsHeaders(request, env);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(obj), { status, headers });
}

function redirectResponse(location, request, env) {
  const headers = corsHeaders(request, env);
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

function contentDispositionForFilename(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "download.zip";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function passthroughHeaders(upstream, filename) {
  const out = new Headers();
  for (const n of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const v = upstream.headers.get(n);
    if (v) out.set(n, v);
  }
  out.set("content-disposition", contentDispositionForFilename(filename));
  return out;
}

function readFilenameParam(reqUrl) {
  const filename = reqUrl.searchParams.get("filename")?.trim();
  if (filename) return filename;
  return reqUrl.searchParams.get("key")?.trim() || null;
}

function wantsJsonResponse(request) {
  const accept = request.headers.get("Accept") ?? "";
  return accept.includes("application/json");
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function readBearerToken(request) {
  const raw = request.headers.get("Authorization");
  if (raw?.startsWith("Bearer ")) {
    const token = raw.slice(7).trim();
    if (token) return token;
  }
  return null;
}

function readGuestId(request, reqUrl) {
  const raw = request.headers.get("X-Guest-Id");
  if (typeof raw === "string" && UUID_RE.test(raw.trim())) return raw.trim();
  const q = reqUrl.searchParams.get("guest")?.trim();
  return q && UUID_RE.test(q) ? q : null;
}

async function verifySupabaseUser(env, token) {
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !apiKey) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: apiKey },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === "string" ? user.id : null;
}

async function guestDownloadHeaders(env) {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRole } = env;
  if (!url || !serviceRole) return null;
  return { url, headers: { apikey: serviceRole, Authorization: `Bearer ${serviceRole}` } };
}

async function fetchGuestDownloadRow(env, guestId) {
  const cfg = await guestDownloadHeaders(env);
  if (!cfg) return { cfg: null, row: null, unavailable: true };

  const res = await fetch(
    `${cfg.url}/rest/v1/guest_downloads?guest_id=eq.${guestId}&select=guest_id,filename,downloaded_at`,
    { headers: cfg.headers }
  );
  if (res.status === 404) {
    console.warn("guest_downloads table missing; denying guest download.");
    return { cfg: null, row: null, unavailable: true };
  }
  if (!res.ok) throw new Error(`guest lookup failed: ${res.status}`);
  const rows = await res.json();
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return { cfg, row, unavailable: false };
}

async function clearGuestDownload(env, guestId) {
  const cfg = await guestDownloadHeaders(env);
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/rest/v1/guest_downloads?guest_id=eq.${guestId}`, {
    method: "DELETE",
    headers: cfg.headers,
  });
  if (res.status === 404) return;
  if (!res.ok) console.warn(`guest clear failed: ${res.status}`);
}

async function getGuestDownloadState(env, guestId) {
  const { cfg, row, unavailable } = await fetchGuestDownloadRow(env, guestId);
  if (unavailable) return { active: false, unavailable: true };
  if (!cfg || !row) return { active: false, unavailable: false };

  const started = Date.parse(row.downloaded_at);
  if (!Number.isFinite(started) || Date.now() - started > GUEST_ACTIVE_STALE_MS) {
    await clearGuestDownload(env, guestId);
    return { active: false, unavailable: false };
  }
  return { active: true, filename: row.filename, unavailable: false };
}

async function checkGuestDownloadAllowed(env, guestId, filename) {
  const state = await getGuestDownloadState(env, guestId);
  if (state.unavailable) {
    return { ok: false, status: 503, error: "guest_tracking_unavailable" };
  }
  if (!state.active) return { ok: true };
  if (state.filename === filename) return { ok: true };
  return { ok: false, reason: "guest_active", active_filename: state.filename };
}

async function setGuestDownloadActive(env, guestId, filename) {
  const cfg = await guestDownloadHeaders(env);
  if (!cfg) return { ok: false, status: 503, error: "guest_tracking_unavailable" };

  const allowed = await checkGuestDownloadAllowed(env, guestId, filename);
  if (!allowed.ok) return allowed;

  const upsert = await fetch(`${cfg.url}/rest/v1/guest_downloads`, {
    method: "POST",
    headers: {
      ...cfg.headers,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ guest_id: guestId, filename, downloaded_at: new Date().toISOString() }),
  });
  if (upsert.status === 404) {
    console.warn("guest_downloads table missing; denying guest download.");
    return { ok: false, status: 503, error: "guest_tracking_unavailable" };
  }
  if (!upsert.ok) throw new Error(`guest upsert failed: ${upsert.status}`);
  return { ok: true };
}

function responseWithGuestRelease(env, guestId, upstream, filename, request, workerEnv) {
  if (!upstream.body) {
    void clearGuestDownload(env, guestId);
    const headers = passthroughHeaders(upstream, filename);
    for (const [name, value] of corsHeaders(request, workerEnv)) headers.set(name, value);
    return new Response(null, { status: upstream.status, headers });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = upstream.body.getReader();

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch {
      /* client aborted or upstream error */
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      await clearGuestDownload(env, guestId);
    }
  })();

  const headers = passthroughHeaders(upstream, filename);
  for (const [name, value] of corsHeaders(request, workerEnv)) headers.set(name, value);
  return new Response(readable, { status: upstream.status, headers });
}

async function resolveIdentity(request, env, reqUrl) {
  const token = readBearerToken(request);
  if (token) {
    const userId = await verifySupabaseUser(env, token);
    if (userId) return { ok: true, identityType: "user", identityId: userId };
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 503, error: "misconfigured" };
  }

  const guestId = readGuestId(request, reqUrl);
  if (!guestId) return { ok: false, status: 401, error: "auth_required" };

  return { ok: true, identityType: "guest", identityId: guestId, guestId };
}

async function authorizeDownloadResolve(request, env, reqUrl, filename) {
  const identity = await resolveIdentity(request, env, reqUrl);
  if (!identity.ok) return identity;

  if (identity.identityType === "guest") {
    try {
      const guest = await checkGuestDownloadAllowed(env, identity.guestId, filename);
      if (!guest.ok) {
        return {
          ok: false,
          status: guest.status ?? 403,
          error: guest.reason ?? guest.error ?? "guest_active",
          active_filename: guest.active_filename,
        };
      }
    } catch (error) {
      console.warn("Guest download tracking unavailable; denying download.", error);
      return { ok: false, status: 503, error: "guest_tracking_unavailable" };
    }
  }

  return {
    ok: true,
    identityType: identity.identityType,
    identityId: identity.identityId,
    guestId: identity.guestId,
  };
}

async function authorizeDownloadFile(env, ticket, filename) {
  const verified = await verifyDownloadTicket(env, ticket, filename);
  if (!verified.ok) {
    return { ok: false, status: 403, error: verified.reason ?? "invalid_ticket" };
  }

  if (verified.identityType === "guest") {
    try {
      const guest = await setGuestDownloadActive(env, verified.guestId, filename);
      if (!guest.ok) {
        return {
          ok: false,
          status: guest.status ?? 403,
          error: guest.reason ?? guest.error ?? "guest_active",
          active_filename: guest.active_filename,
        };
      }
      return { ok: true, guestId: verified.guestId, identityType: "guest", identityId: verified.guestId };
    } catch (error) {
      console.warn("Guest download tracking unavailable; denying download.", error);
      return { ok: false, status: 503, error: "guest_tracking_unavailable" };
    }
  }

  return {
    ok: true,
    identityType: "user",
    identityId: verified.userId,
  };
}

// ---------------------------------------------------------------------------
// IA cookie pool + URL resolution
// ---------------------------------------------------------------------------

async function loadIaCookiePool(env) {
  const now = Date.now();
  if (cookiePoolCache.pool && now < cookiePoolCache.expiresAt) {
    return cookiePoolCache.pool;
  }

  const pool = await fetchIaCookiePoolFromSupabase(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );
  cookiePoolCache = { pool, expiresAt: now + COOKIE_POOL_TTL_MS };
  return pool;
}

async function pickIaCookie(env) {
  const pool = await loadIaCookiePool(env);
  return pickIaCookiePair(pool);
}

async function resolveIaUrl(archiveUrl, pair) {
  const cookie = buildIaCookieHeader(pair);
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

async function loadFlatFilenameMap(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} fetch ${res.status}`);
  const parsed = await res.json();
  const map = new Map();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [filename, archiveUrl] of Object.entries(parsed)) {
      if (typeof filename === "string" && typeof archiveUrl === "string") {
        map.set(filename, archiveUrl);
      }
    }
  }
  return map;
}

async function getFilenameToUrlMap(env) {
  const now = Date.now();
  if (mapCache.map && now < mapCache.expiresAt) return mapCache.map;

  const map = new Map();

  if (env.IA_FILE_MAP_URL) {
    for (const [filename, url] of await loadFlatFilenameMap(env.IA_FILE_MAP_URL, "ia-file-map")) {
      map.set(filename, url);
    }
  }

  if (env.MASTER_INDEX_URL) {
    const res = await fetch(env.MASTER_INDEX_URL);
    if (!res.ok) throw new Error(`master_index fetch ${res.status}`);
    const list = await res.json();
    if (Array.isArray(list)) {
      for (const title of list) {
        for (const dl of Array.isArray(title?.downloads) ? title.downloads : []) {
          if (typeof dl?.filename === "string" && typeof dl?.url === "string") {
            map.set(dl.filename, dl.url);
          }
        }
      }
    }
  }

  if (!map.size) {
    throw new Error("IA_FILE_MAP_URL or MASTER_INDEX_URL binding is required");
  }

  mapCache = { map, expiresAt: now + MAP_TTL_MS };
  return map;
}

function lookupUrl(filenameMap, key) {
  const raw = filenameMap.get(key);
  if (!raw) return null;
  if (raw === HONEYPOT_MARKER) return HONEYPOT_MARKER;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

async function runSecurityChecks(request, env, reqUrl, filename, route, identityType, identityId, guestId) {
  const kv = env.DOWNLOAD_KV;
  const logCtx = await buildLogContext(request, reqUrl, filename);
  const uaHash = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(request.headers.get("User-Agent") ?? ""))
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));

  if (await checkIpBlocked(kv, logCtx.ip_hash)) {
    await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: "ip_blocked" });
    return { ok: false, status: 403, error: "blocked" };
  }

  const ipLimit = await checkIpRateLimit(kv, logCtx.ip_hash, route);
  if (!ipLimit.ok) {
    await logDownloadAttempt({ ...logCtx, outcome: "rate_limited", scope: "ip", count: ipLimit.count });
    return { ok: false, rateLimited: true, retryAfter: ipLimit.retryAfter };
  }

  if (identityType && identityId) {
    const idLimit = await checkIdentityRateLimit(kv, identityType, identityId);
    if (!idLimit.ok) {
      await logDownloadAttempt({
        ...logCtx,
        outcome: "rate_limited",
        scope: "identity",
        identity_type: identityType,
        count: idLimit.count,
      });
      return { ok: false, rateLimited: true, retryAfter: idLimit.retryAfter };
    }
  }

  if (guestId) {
    const fp = await trackGuestFingerprint(kv, guestId, logCtx.ip_hash, uaHash);
    if (!fp.ok) {
      await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: fp.reason });
      return { ok: false, status: 403, error: fp.reason ?? "blocked" };
    }
  }

  const score = botScore(request);
  if (score >= 8) {
    await blockIp(kv, logCtx.ip_hash, "bot_score_high");
    await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: "bot_score", bot_score: score });
    return { ok: false, status: 403, error: "blocked" };
  }

  if (route === "resolve" && score >= 5) {
    const turnstile = await verifyTurnstile(env, request, reqUrl);
    if (!turnstile.ok) {
      await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: turnstile.reason, bot_score: score });
      return { ok: false, status: 403, error: turnstile.reason ?? "turnstile_required" };
    }
  }

  return { ok: true, logCtx, botScore: score };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" }, request, env);
    }

    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname.replace(/\/$/, "");

    if (path !== "/download" && path !== "/download/file") {
      return jsonResponse(404, { error: "Not found" }, request, env);
    }

    const filename = readFilenameParam(reqUrl);
    if (!filename) return jsonResponse(400, { error: "Missing filename" }, request, env);

    const isFileRoute = path === "/download/file";

    if (!env.DOWNLOAD_SIGNING_SECRET?.trim()) {
      return jsonResponse(503, { error: "misconfigured" }, request, env);
    }

    let filenameMap;
    try {
      filenameMap = await getFilenameToUrlMap(env);
    } catch (e) {
      return jsonResponse(500, { error: e instanceof Error ? e.message : "Map load failed" }, request, env);
    }

    const archiveUrl = lookupUrl(filenameMap, filename);
    if (!archiveUrl) return jsonResponse(400, { error: "Unknown file" }, request, env);

    if (archiveUrl === HONEYPOT_MARKER) {
      const logCtx = await buildLogContext(request, reqUrl, filename);
      await blockIp(env.DOWNLOAD_KV, logCtx.ip_hash, "honeypot_hit", 24 * 60 * 60);
      await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: "honeypot" });
      return jsonResponse(403, { error: "Unknown file" }, request, env);
    }

    let guestId = null;
    let identityType = null;
    let identityId = null;

    if (isFileRoute) {
      const ticket = reqUrl.searchParams.get("ticket")?.trim() ?? "";
      const allowed = await authorizeDownloadFile(env, ticket, filename);
      if (!allowed.ok) {
        const logCtx = await buildLogContext(request, reqUrl, filename);
        await logDownloadAttempt({
          ...logCtx,
          outcome: allowed.error === "invalid_ticket" || allowed.error === "expired_ticket"
            ? "invalid_ticket"
            : "blocked",
          reason: allowed.error,
        });
        return jsonResponse(
          allowed.status ?? 403,
          { error: allowed.error, active_filename: allowed.active_filename },
          request,
          env
        );
      }
      guestId = allowed.guestId ?? null;
      identityType = allowed.identityType;
      identityId = allowed.identityId;
    } else {
      const allowed = await authorizeDownloadResolve(request, env, reqUrl, filename);
      if (!allowed.ok) {
        const logCtx = await buildLogContext(request, reqUrl, filename);
        await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: allowed.error });
        return jsonResponse(
          allowed.status ?? 403,
          { error: allowed.error, active_filename: allowed.active_filename },
          request,
          env
        );
      }
      guestId = allowed.guestId ?? null;
      identityType = allowed.identityType;
      identityId = allowed.identityId;

      const score = botScore(request);
      const turnstileConfigured = Boolean(env.TURNSTILE_SECRET_KEY?.trim());
      if (turnstileConfigured || score >= 5) {
        if (!turnstileConfigured && score >= 5) {
          const logCtx = await buildLogContext(request, reqUrl, filename);
          await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: "bot_score", bot_score: score });
          return jsonResponse(403, { error: "blocked" }, request, env);
        }
        const turnstile = await verifyTurnstile(env, request, reqUrl);
        if (!turnstile.ok) {
          const logCtx = await buildLogContext(request, reqUrl, filename);
          await logDownloadAttempt({ ...logCtx, outcome: "blocked", reason: turnstile.reason, bot_score: score });
          return jsonResponse(403, { error: turnstile.reason ?? "turnstile_required" }, request, env);
        }
      }
    }

    const security = await runSecurityChecks(
      request,
      env,
      reqUrl,
      filename,
      isFileRoute ? "file" : "resolve",
      identityType,
      identityId,
      guestId
    );
    if (!security.ok) {
      if (security.rateLimited) {
        return rateLimitResponse(security.retryAfter ?? 60, request, env);
      }
      return jsonResponse(security.status ?? 403, { error: security.error ?? "blocked" }, request, env);
    }

    if (path === "/download") {
      let ticket;
      try {
        ticket = await createDownloadTicket(env, identityType, identityId, filename);
      } catch (e) {
        return jsonResponse(
          503,
          { error: e instanceof Error ? e.message : "Ticket creation failed" },
          request,
          env
        );
      }

      const fileUrl = buildTicketDownloadUrl(reqUrl, filename, ticket);
      await logDownloadAttempt({
        ...security.logCtx,
        outcome: "ticket_issued",
        identity_type: identityType,
      });

      if (wantsJsonResponse(request)) {
        return jsonResponse(200, { redirect: fileUrl, filename }, request, env);
      }
      return redirectResponse(fileUrl, request, env);
    }

    // /download/file — resolve IA CDN URL and stream
    await logDownloadAttempt({
      ...security.logCtx,
      outcome: "allowed",
      identity_type: identityType,
    });

    const pair = await pickIaCookie(env);
    if (!pair) return jsonResponse(503, { error: "IA cookie pool not configured on worker" }, request, env);

    const cookie = buildIaCookieHeader(pair);
    const resolved = await resolveIaUrl(archiveUrl, pair);
    if (!resolved.verified) {
      recordIaCookieUse(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, pair.id, "resolve_fail");
      return jsonResponse(502, { error: "Could not resolve Archive download URL" }, request, env);
    }

    recordIaCookieUse(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, pair.id, "ok");

    const upstreamHeaders = { Cookie: cookie };
    const range = request.headers.get("Range");
    if (range) upstreamHeaders.Range = range;

    let upstream;
    try {
      upstream = await fetch(resolved.url, { redirect: "follow", headers: upstreamHeaders });
    } catch {
      if (guestId) ctx.waitUntil(clearGuestDownload(env, guestId));
      return jsonResponse(502, { error: "Upstream fetch failed" }, request, env);
    }

    if (!upstream.ok) {
      if (guestId) ctx.waitUntil(clearGuestDownload(env, guestId));
      const headers = passthroughHeaders(upstream, filename);
      for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    if (guestId) {
      return responseWithGuestRelease(env, guestId, upstream, filename, request, env);
    }

    const headers = passthroughHeaders(upstream, filename);
    for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
