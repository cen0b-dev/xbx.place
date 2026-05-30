/**
 * Download security helpers: HMAC tickets, rate limits, fingerprints, logging.
 */

export const HONEYPOT_MARKER = "__HONEYPOT__";
export const TICKET_WINDOW_SEC = 300;
export const ALLOWED_ORIGINS = new Set(["https://xbx.place", "http://localhost:5173", "http://127.0.0.1:5173"]);

const SCRAPER_UA_RE =
  /python-requests|curl\/|wget\/|Go-http-client|scrapy|httpclient|java\/|libwww|axios\/|node-fetch/i;

const IP_RATE_RESOLVE = { limit: 20, windowSec: 60 };
const IP_RATE_FILE = { limit: 6, windowSec: 60 };
const IDENTITY_RATE = { limit: 5, windowSec: 600 };
const GUEST_ROTATION_LIMIT = 10;
const GUEST_ROTATION_WINDOW_SEC = 300;
const GUEST_FP_TTL_SEC = 24 * 60 * 60;
const IP_BLOCK_TTL_SEC = 60 * 60;

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP")?.trim() ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin")?.trim() || "";
  const allowed = env.ALLOWED_ORIGIN?.trim();
  const allowList = allowed ? new Set([allowed, ...ALLOWED_ORIGINS]) : ALLOWED_ORIGINS;
  const out = new Headers();
  if (origin && allowList.has(origin)) {
    out.set("access-control-allow-origin", origin);
    out.set("vary", "Origin");
  } else if (!origin) {
    out.set("access-control-allow-origin", "https://xbx.place");
  }
  out.set("access-control-allow-methods", "GET, OPTIONS");
  out.set(
    "access-control-allow-headers",
    "Authorization, X-Guest-Id, Content-Type, Range, CF-Turnstile-Response"
  );
  out.set("access-control-expose-headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Location");
  return out;
}

export function botScore(request) {
  let score = 0;
  const ua = request.headers.get("User-Agent")?.trim() ?? "";
  if (!ua) score += 3;
  else if (SCRAPER_UA_RE.test(ua)) score += 3;
  if (!request.headers.get("Accept")?.trim()) score += 2;
  if (!request.headers.get("Accept-Language")?.trim()) score += 2;
  const fetchMode = request.headers.get("Sec-Fetch-Mode");
  if (fetchMode && fetchMode !== "navigate") score += 1;
  const threat = Number(request.cf?.threatScore ?? 0);
  if (threat > 10) score += 3;
  return score;
}

// ---------------------------------------------------------------------------
// HMAC download tickets
// ---------------------------------------------------------------------------

export async function createDownloadTicket(env, identityType, identityId, filename) {
  const secret = env.DOWNLOAD_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("DOWNLOAD_SIGNING_SECRET not configured");

  const window = Math.floor(Date.now() / 1000 / TICKET_WINDOW_SEC);
  const filenameHash = await sha256Hex(filename);
  const payload = `${identityType}:${identityId}:${filenameHash}:${window}`;
  const mac = await hmacSha256Hex(secret, payload);
  return `${window}.${identityType}.${identityId}.${filenameHash}.${mac}`;
}

export async function verifyDownloadTicket(env, ticket, filename) {
  const secret = env.DOWNLOAD_SIGNING_SECRET?.trim();
  if (!secret || !ticket) return { ok: false, reason: "missing_ticket" };

  const parts = ticket.split(".");
  if (parts.length !== 5) return { ok: false, reason: "invalid_ticket" };

  const [windowStr, identityType, identityId, filenameHash, mac] = parts;
  const window = Number(windowStr);
  if (!Number.isFinite(window)) return { ok: false, reason: "invalid_ticket" };

  const nowWindow = Math.floor(Date.now() / 1000 / TICKET_WINDOW_SEC);
  if (window < nowWindow - 1 || window > nowWindow) {
    return { ok: false, reason: "expired_ticket" };
  }

  const expectedFilenameHash = await sha256Hex(filename);
  if (!timingSafeEqual(filenameHash, expectedFilenameHash)) {
    return { ok: false, reason: "filename_mismatch" };
  }

  const payload = `${identityType}:${identityId}:${filenameHash}:${window}`;
  const expectedMac = await hmacSha256Hex(secret, payload);
  if (!timingSafeEqual(mac, expectedMac)) return { ok: false, reason: "invalid_ticket" };

  if (identityType !== "guest" && identityType !== "user") {
    return { ok: false, reason: "invalid_ticket" };
  }

  return {
    ok: true,
    identityType,
    identityId,
    guestId: identityType === "guest" ? identityId : undefined,
    userId: identityType === "user" ? identityId : undefined,
  };
}

export function buildTicketDownloadUrl(reqUrl, filename, ticket) {
  const url = new URL("/download/file", reqUrl.origin);
  url.searchParams.set("filename", filename);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

export async function verifyTurnstile(env, request, reqUrl) {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: true, skipped: true };

  const token =
    request.headers.get("CF-Turnstile-Response")?.trim() ||
    reqUrl.searchParams.get("turnstile_token")?.trim() ||
    "";
  if (!token) return { ok: false, reason: "turnstile_required" };

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: getClientIp(request),
  });

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return { ok: false, reason: "turnstile_failed" };
  const data = await res.json();
  if (!data.success) return { ok: false, reason: "turnstile_failed" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// KV rate limiting & abuse detection
// ---------------------------------------------------------------------------

async function kvGetInt(kv, key) {
  if (!kv) return 0;
  const raw = await kv.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function kvIncr(kv, key, ttlSec) {
  if (!kv) return 1;
  const current = await kvGetInt(kv, key);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttlSec });
  return next;
}

function bucketKey(prefix, hash, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  return `${prefix}:${hash}:${bucket}`;
}

export async function checkIpBlocked(kv, ipHash) {
  if (!kv) return false;
  const raw = await kv.get(`block:ip:${ipHash}`);
  if (!raw) return false;
  const until = Number(raw);
  return Number.isFinite(until) && until > Date.now();
}

export async function blockIp(kv, ipHash, reason, ttlSec = IP_BLOCK_TTL_SEC) {
  if (!kv) return;
  const until = Date.now() + ttlSec * 1000;
  await kv.put(`block:ip:${ipHash}`, String(until), { expirationTtl: ttlSec });
  console.warn(JSON.stringify({ event: "ip_blocked", reason, ip_hash: ipHash, ttl_sec: ttlSec }));
}

export async function checkIpRateLimit(kv, ipHash, route, { isRangeResume = false } = {}) {
  if (isRangeResume) return { ok: true, count: 0 };
  const cfg = route === "file" ? IP_RATE_FILE : IP_RATE_RESOLVE;
  const key = bucketKey(`rl:ip:${route}`, ipHash, cfg.windowSec);
  const count = await kvIncr(kv, key, cfg.windowSec + 5);
  if (count > cfg.limit * 2) {
    await blockIp(kv, ipHash, "ip_rate_sustained");
  } else if (count > cfg.limit) {
    const retryAfter = cfg.windowSec - (Math.floor(Date.now() / 1000) % cfg.windowSec);
    return { ok: false, retryAfter, count };
  }
  if (count >= Math.ceil(cfg.limit * 0.8)) {
    await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 2000)));
  }
  return { ok: true, count };
}

export async function checkIdentityRateLimit(kv, identityType, identityId) {
  if (!kv || !identityId) return { ok: true };
  const idHash = await sha256Hex(`${identityType}:${identityId}`);
  const key = bucketKey(`rl:id`, idHash, IDENTITY_RATE.windowSec);
  const count = await kvIncr(kv, key, IDENTITY_RATE.windowSec + 30);
  if (count > IDENTITY_RATE.limit) {
    const retryAfter =
      IDENTITY_RATE.windowSec - (Math.floor(Date.now() / 1000) % IDENTITY_RATE.windowSec);
    return { ok: false, retryAfter, count };
  }
  return { ok: true, count };
}

export async function trackGuestFingerprint(kv, guestId, ipHash, uaHash) {
  if (!kv || !guestId) return { ok: true };

  const fpKey = `guest:fp:${guestId}`;
  const existing = await kv.get(fpKey);
  if (!existing) {
    await kv.put(fpKey, `${ipHash}|${uaHash}`, { expirationTtl: GUEST_FP_TTL_SEC });
  } else {
    const [storedIp, storedUa] = existing.split("|");
    if (storedIp !== ipHash || storedUa !== uaHash) {
      console.warn(
        JSON.stringify({
          event: "guest_fingerprint_mismatch",
          guest_id_hash: await sha256Hex(guestId),
          ip_hash: ipHash,
        })
      );
    }
  }

  const rotKey = bucketKey(`rot:ip`, ipHash, GUEST_ROTATION_WINDOW_SEC);
  const seenKey = `${rotKey}:seen:${guestId}`;
  const alreadySeen = await kv.get(seenKey);
  if (!alreadySeen) {
    await kv.put(seenKey, "1", { expirationTtl: GUEST_ROTATION_WINDOW_SEC + 10 });
    const count = await kvIncr(kv, rotKey, GUEST_ROTATION_WINDOW_SEC + 10);
    if (count >= GUEST_ROTATION_LIMIT) {
      await blockIp(kv, ipHash, "guest_uuid_rotation", IP_BLOCK_TTL_SEC);
      return { ok: false, reason: "abuse_detected" };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

export async function logDownloadAttempt(fields) {
  console.log(
    JSON.stringify({
      event: "download_attempt",
      ts: Math.floor(Date.now() / 1000),
      ...fields,
    })
  );
}

export async function buildLogContext(request, reqUrl, filename) {
  const ip = getClientIp(request);
  const ipHash = await sha256Hex(ip);
  const filenameHash = filename ? await sha256Hex(filename) : null;
  return {
    ip_hash: ipHash,
    filename_hash: filenameHash,
    cf_country: request.headers.get("CF-IPCountry") ?? null,
    cf_threat_score: Number(request.cf?.threatScore ?? 0),
    ua_present: Boolean(request.headers.get("User-Agent")?.trim()),
    path: reqUrl.pathname,
  };
}

export function rateLimitResponse(retryAfter, request, env) {
  const headers = corsHeaders(request, env);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("retry-after", String(retryAfter));
  return new Response(JSON.stringify({ error: "rate_limited", retry_after: retryAfter }), {
    status: 429,
    headers,
  });
}
