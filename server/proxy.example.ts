import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT ?? "8787");
const ALLOWED_DOWNLOAD_HOSTS = (process.env.ALLOWED_DOWNLOAD_HOSTS ?? "archive.org,vimm.net,file.romsworlds.com,1fichier.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const MASTER_INDEX_PATH = process.env.MASTER_INDEX_PATH ?? path.join(process.cwd(), "public", "master_index.json");
const DOWNLOAD_URLS = new Map<string, string>();
const IA_COOKIE_POOL: Array<{ user: string; sig: string }> = [];

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

/** Same format as build:ia-map — JSON array in `IA_COOKIE_POOL`, never committed. */
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
  const rounds = getDecodeRounds();
  const decodedPool = decodeBase64Rounds(process.env.IA_COOKIE_POOL_B64, rounds);
  const fromPool = parseIaCookiePoolJson(process.env.IA_COOKIE_POOL ?? decodedPool ?? undefined);
  for (const p of fromPool) {
    IA_COOKIE_POOL.push(p);
  }
  if (!IA_COOKIE_POOL.length) {
    pushSingleAccountFromEnv();
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

async function main(): Promise<void> {
  await loadDownloadMap();
  await loadIaCookiePool();

  createServer(async (req, res) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const target = parseTarget(req);
    if (!target) {
      sendJson(res, 400, { error: "Invalid or unknown key" });
      return;
    }

    const headers: Record<string, string> = {};
    if (target.hostname.endsWith("archive.org")) {
      const pair = pickIaCookiePair();
      if (pair) {
        headers.cookie = `logged-in-user=${pair.user}; logged-in-sig=${pair.sig};`;
      }
    }

    const upstream = await fetch(target, { redirect: "follow", headers });

    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    const contentDisposition = upstream.headers.get("content-disposition");
    const contentLength = upstream.headers.get("content-length");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }
    if (contentDisposition) {
      res.setHeader("content-disposition", contentDisposition);
    }
    if (contentLength) {
      res.setHeader("content-length", contentLength);
    }

    // A hardened proxy should stream, add auth/rate-limit, and forward range headers.
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
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
