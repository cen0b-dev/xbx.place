import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";

const PORT = Number(process.env.PORT ?? "8787");
const ALLOWED_DOWNLOAD_HOSTS = (process.env.ALLOWED_DOWNLOAD_HOSTS ?? "archive.org,vimm.net,file.romsworlds.com,1fichier.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const MASTER_INDEX_PATH = process.env.MASTER_INDEX_PATH ?? path.join(process.cwd(), "public", "master_index.json");
const ENV_PATH = path.join(process.cwd(), ".env.local");
const DOWNLOAD_URLS = new Map<string, string>();
const IA_COOKIE_POOL: Array<{ user: string; sig: string }> = [];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let supabaseAdmin: ReturnType<typeof createClient> | null = null;
let supabaseAnonKey = "";
let supabaseUrl = "";

function canonicalizeCookieValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\r\n;\0]/.test(trimmed)) return null;
  try {
    return encodeURIComponent(decodeURIComponent(trimmed));
  } catch {
    return encodeURIComponent(trimmed);
  }
}

function decodeBase64Rounds(raw: string | undefined, rounds: number): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let out = raw.trim();
  const count = Number.isInteger(rounds) && rounds > 0 ? rounds : 1;
  try {
    for (let i = 0; i < count; i += 1) {
      out = Buffer.from(out, "base64").toString("utf8");
    }
    return out;
  } catch {
    return null;
  }
}

function getDecodeRounds(): number {
  const parsed = Number.parseInt(process.env.IA_COOKIE_B64_ROUNDS ?? "1", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseEnvLine(line: string): [string | null, string | null] {
  const eqIdx = line.indexOf("=");
  if (eqIdx <= 0) return [null, null];
  const key = line.slice(0, eqIdx).trim();
  const value = parseEnvValue(line.slice(eqIdx + 1));
  return [key || null, value || null];
}

function parseEnvValue(raw: string): string {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return sanitizeSecret(value.slice(1, -1));
  }

  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === "#" && !inSingle && !inDouble) {
      value = value.slice(0, i).trim();
      break;
    }
  }
  return sanitizeSecret(value);
}

function isLikelySupabaseSecret(value: string): boolean {
  return value.startsWith("eyJ") && value.length > 80 && !value.includes("...");
}

function jwtProjectRef(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

function supabaseHostRef(url: string): string | null {
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

async function loadLocalEnvMap(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const raw = await readFile(ENV_PATH, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, value] = parseEnvLine(trimmed);
      if (!key || !value) continue;
      out.set(key, value);
    }
  } catch {
    // .env.local is optional.
  }
  return out;
}

/** Same format as build:ia-map — JSON array in `IA_COOKIE_POOL` (or base64 in `IA_COOKIE_POOL_B64`), never committed. */
function parseIaCookiePoolJson(raw: string | undefined): Array<{ user: string; sig: string }> {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Array<{ user: string; sig: string }> = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const rec = entry as { user?: unknown; sig?: unknown };
      const user = canonicalizeCookieValue(rec.user);
      const sig = canonicalizeCookieValue(rec.sig);
      if (!user || !sig) continue;
      out.push({ user, sig });
    }
    return out;
  } catch {
    return [];
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  } else {
    res.setHeader("access-control-allow-origin", "*");
  }
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization, X-Guest-Id, Content-Type");
}

function readBearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (typeof raw === "string" && raw.startsWith("Bearer ")) {
    const token = raw.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const fromQuery = url.searchParams.get("access_token")?.trim();
  return fromQuery || null;
}

function readGuestId(req: IncomingMessage): string | null {
  const raw = req.headers["x-guest-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (UUID_RE.test(trimmed)) return trimmed;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const fromQuery = url.searchParams.get("guest")?.trim();
  return fromQuery && UUID_RE.test(fromQuery) ? fromQuery : null;
}

async function verifySupabaseUser(token: string): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey
    }
  });
  return response.ok;
}

let guestDownloadTrackingEnabled = true;

function isMissingGuestDownloadsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string; status?: number; details?: string };
  const message = `${row.message ?? ""} ${row.details ?? ""}`;
  return (
    row.code === "PGRST205" ||
    row.code === "42P01" ||
    row.status === 404 ||
    /guest_downloads.*(does not exist|could not find|not found)/i.test(message)
  );
}

async function allowGuestDownload(guestId: string, filename: string): Promise<{ ok: true } | { ok: false; reason: "guest_limit" }> {
  if (!supabaseAdmin || !guestDownloadTrackingEnabled) return { ok: true };

  try {
    const { data, error: lookupError } = await supabaseAdmin
      .from("guest_downloads")
      .select("guest_id")
      .eq("guest_id", guestId)
      .maybeSingle();
    if (lookupError) {
      if (isMissingGuestDownloadsTable(lookupError)) {
        guestDownloadTrackingEnabled = false;
        // eslint-disable-next-line no-console
        console.warn(
          "guest_downloads table is missing in Supabase. Guest limits disabled until you apply supabase/migrations/20260527120000_guest_downloads.sql."
        );
        return { ok: true };
      }
      throw lookupError;
    }
    if (data) return { ok: false, reason: "guest_limit" };

    const { error: insertError } = await supabaseAdmin.from("guest_downloads").insert({ guest_id: guestId, filename });
    if (insertError) {
      if (insertError.code === "23505") return { ok: false, reason: "guest_limit" };
      if (isMissingGuestDownloadsTable(insertError)) {
        guestDownloadTrackingEnabled = false;
        // eslint-disable-next-line no-console
        console.warn(
          "guest_downloads table is missing in Supabase. Guest limits disabled until you apply supabase/migrations/20260527120000_guest_downloads.sql."
        );
        return { ok: true };
      }
      throw insertError;
    }
    return { ok: true };
  } catch (error) {
    if (isMissingGuestDownloadsTable(error)) {
      guestDownloadTrackingEnabled = false;
      // eslint-disable-next-line no-console
      console.warn(
        "guest_downloads table is missing in Supabase. Guest limits disabled until you apply supabase/migrations/20260527120000_guest_downloads.sql."
      );
      return { ok: true };
    }
    guestDownloadTrackingEnabled = false;
    // eslint-disable-next-line no-console
    console.warn("Guest download tracking unavailable; allowing download.", error);
    return { ok: true };
  }
}

async function authorizeDownload(req: IncomingMessage, filename: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const token = readBearerToken(req);
  if (token && (await verifySupabaseUser(token))) {
    return { ok: true };
  }

  if (!supabaseAdmin) {
    return { ok: true };
  }

  const guestId = readGuestId(req);
  if (!guestId) {
    return { ok: false, status: 401, error: "auth_required" };
  }

  const guest = await allowGuestDownload(guestId, filename);
  if (!guest.ok) {
    return { ok: false, status: 403, error: guest.reason };
  }
  return { ok: true };
}

function sanitizeSecret(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[\u2013\u2014\u2018\u2019\u201C\u201D\u00A0]/g, (ch) => {
      if (ch === "\u2013" || ch === "\u2014") return "-";
      if (ch === "\u2018" || ch === "\u2019") return "'";
      if (ch === "\u201C" || ch === "\u201D") return '"';
      return "";
    });
}

function initSupabaseFromEnv(envMap: Map<string, string>): void {
  supabaseUrl = sanitizeSecret(process.env.SUPABASE_URL ?? envMap.get("SUPABASE_URL") ?? "");
  supabaseAnonKey = sanitizeSecret(process.env.SUPABASE_ANON_KEY ?? envMap.get("SUPABASE_ANON_KEY") ?? "");
  const serviceRole = sanitizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY ?? envMap.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  if (supabaseUrl && serviceRole && isLikelySupabaseSecret(serviceRole)) {
    const urlRef = supabaseHostRef(supabaseUrl);
    const keyRef = jwtProjectRef(serviceRole);
    if (urlRef && keyRef && urlRef !== keyRef) {
      // eslint-disable-next-line no-console
      console.warn(
        `SUPABASE_SERVICE_ROLE_KEY is for project "${keyRef}" but SUPABASE_URL points at "${urlRef}". Guest download tracking will fail — copy the service role key from the matching project dashboard.`
      );
    }
    supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } else if (serviceRole && !isLikelySupabaseSecret(serviceRole)) {
    // eslint-disable-next-line no-console
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY is missing or still a placeholder. Guest download limits are disabled until you set the real service role key in .env.local."
    );
  }
}

function getRequestedKey(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/download") return null;
  const key = url.searchParams.get("key");
  return key && key.trim() ? key : null;
}

function makeDispositionFilename(key: string): string {
  const decoded = decodeURIComponent(key);
  const safe = decoded.replace(/[\r\n"]/g, "_");
  const encoded = encodeURIComponent(decoded);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function parseTarget(req: IncomingMessage): URL | null {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/download") return null;
  const key = url.searchParams.get("key");
  if (!key) return null;
  const target = DOWNLOAD_URLS.get(key);
  if (!target) return null;
  const parsed = new URL(target);
  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_DOWNLOAD_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) return null;
  return parsed;
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_DOWNLOAD_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function pickIaCookiePair() {
  if (!IA_COOKIE_POOL.length) return null;
  const idx = Math.floor(Math.random() * IA_COOKIE_POOL.length);
  return IA_COOKIE_POOL[idx] ?? null;
}

function pushSingleAccountFromEnv(): void {
  const user = canonicalizeCookieValue(process.env.IA_LOGGED_IN_USER);
  const sig = canonicalizeCookieValue(process.env.IA_LOGGED_IN_SIG);
  if (user && sig) {
    IA_COOKIE_POOL.push({ user, sig });
  }
}

async function loadIaCookiePool(): Promise<void> {
  const envMap = await loadLocalEnvMap();
  const rounds = Number.parseInt(process.env.IA_COOKIE_B64_ROUNDS ?? envMap.get("IA_COOKIE_B64_ROUNDS") ?? "1", 10);
  const roundsSafe = Number.isInteger(rounds) && rounds > 0 ? rounds : getDecodeRounds();
  const decodedPool = decodeBase64Rounds(process.env.IA_COOKIE_POOL_B64 ?? envMap.get("IA_COOKIE_POOL_B64"), roundsSafe);
  const rawPool = process.env.IA_COOKIE_POOL ?? envMap.get("IA_COOKIE_POOL") ?? decodedPool ?? undefined;
  const fromPool = parseIaCookiePoolJson(rawPool);
  for (const p of fromPool) {
    IA_COOKIE_POOL.push(p);
  }
  if (!IA_COOKIE_POOL.length) {
    const singleUser = canonicalizeCookieValue(process.env.IA_LOGGED_IN_USER ?? envMap.get("IA_LOGGED_IN_USER"));
    const singleSig = canonicalizeCookieValue(process.env.IA_LOGGED_IN_SIG ?? envMap.get("IA_LOGGED_IN_SIG"));
    if (singleUser && singleSig) {
      IA_COOKIE_POOL.push({ user: singleUser, sig: singleSig });
    } else {
      pushSingleAccountFromEnv();
    }
  }
}

async function loadDownloadMap(): Promise<void> {
  const raw = await readFile(MASTER_INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : [];
  for (const title of list) {
    const downloads = Array.isArray(title?.downloads) ? title.downloads : [];
    for (const dl of downloads) {
      if (typeof dl?.filename !== "string" || typeof dl?.url !== "string") continue;
      DOWNLOAD_URLS.set(dl.filename, dl.url);
    }
  }
}

async function fetchWithRedirects(target: URL, headers: Record<string, string>, maxHops = 6): Promise<Response> {
  let current = target;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const reqHeaders: Record<string, string> = { ...headers };
    const host = current.hostname.toLowerCase();
    // Reattach IA cookie on each archive.org hop. Node fetch strips it across cross-host redirects.
    if (host.endsWith("archive.org") && headers.cookie) {
      reqHeaders.cookie = headers.cookie;
    } else {
      delete reqHeaders.cookie;
    }
    const upstream = await fetch(current, { redirect: "manual", headers: reqHeaders });
    const isRedirect = upstream.status >= 300 && upstream.status < 400;
    if (!isRedirect) return upstream;

    const location = upstream.headers.get("location");
    if (!location) return upstream;
    const next = new URL(location, current);
    if (!isAllowedHost(next.hostname.toLowerCase())) {
      throw new Error(`Redirect target host not allowed: ${next.hostname}`);
    }
    current = next;
  }
  throw new Error("Too many redirects from upstream");
}

async function main(): Promise<void> {
  const envMap = await loadLocalEnvMap();
  initSupabaseFromEnv(envMap);
  await loadDownloadMap();
  await loadIaCookiePool();

  createServer(async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const requestedKey = getRequestedKey(req);
    const target = parseTarget(req);
    if (!target || !requestedKey) {
      sendJson(res, 400, { error: "Invalid or unknown key" });
      return;
    }

    try {
      const allowed = await authorizeDownload(req, requestedKey);
      if (!allowed.ok) {
        sendJson(res, allowed.status, { error: allowed.error });
        return;
      }
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Authorization failed" });
      return;
    }

    const headers: Record<string, string> = {};
    if (target.hostname.endsWith("archive.org")) {
      const pair = pickIaCookiePair();
      if (pair) {
        headers.cookie = `logged-in-user=${pair.user}; logged-in-sig=${pair.sig};`;
      }
    }

    const upstream = await fetchWithRedirects(target, headers);

    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    const contentDisposition = upstream.headers.get("content-disposition");
    const contentLength = upstream.headers.get("content-length");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }
    if (requestedKey) {
      res.setHeader("content-disposition", makeDispositionFilename(requestedKey));
    } else if (contentDisposition) {
      res.setHeader("content-disposition", contentDisposition);
    }
    if (contentLength) {
      res.setHeader("content-length", contentLength);
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    // Stream immediately so browser download tabs do not sit on about:blank while whole files buffer.
    Readable.fromWeb(upstream.body as any).pipe(res);
  }).listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Proxy listening on http://localhost:${PORT} with ${DOWNLOAD_URLS.size} mapped files and ${IA_COOKIE_POOL.length} IA accounts`
    );
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
