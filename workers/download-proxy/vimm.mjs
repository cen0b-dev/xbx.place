/**
 * Vimm's Lair vault parser + proxied download stream.
 * Ported from vimm-dl VaultPageParser / DownloadService patterns.
 */

export const VIMM_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MEDIA_ID_RE_1 = /name="mediaId"\s+value="(\d+)"/i;
const MEDIA_ID_RE_2 = /value="(\d+)"\s+name="mediaId"/i;
const TITLE_RE = /<title>(?:The Vault:\s*)?(.+?)\s*<\/title>/i;
const FORM_ACTION_1 = /id="dl_form"[^>]*action="([^"]+)"/i;
const FORM_ACTION_2 = /action="([^"]+)"[^>]*id="dl_form"/i;
const JS_ACTION_RE = /\.action\s*=\s*['"]([^'"]+)['"]/i;
const DL_SERVER_RE = /(https?:\/\/dl\d*\.vimm\.net\/?)/i;
const DL_SERVER_PROTO_REL_RE = /(\/\/dl\d*\.vimm\.net\/?)/i;
const FORMAT_OPTION_RE = /<option\s+value="(\d+)"\s+title="[^"]*">[^<]+<\/option>/gi;

function decodeHtml(text) {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export function normalizeVaultUrl(input) {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return `https://vimm.net/vault/${raw}`;
  try {
    const url = new URL(raw);
    if (!/^vimm\.net$/i.test(url.hostname)) return null;
    if (!/^\/vault\/\d+/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractMediaId(html) {
  const m1 = html.match(MEDIA_ID_RE_1);
  if (m1) return m1[1];
  const m2 = html.match(MEDIA_ID_RE_2);
  return m2 ? m2[1] : null;
}

function extractAvailableFormats(html) {
  const formats = new Set();
  for (const match of html.matchAll(FORMAT_OPTION_RE)) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n)) formats.add(n);
  }
  return formats;
}

function resolveFormat(preferred, available) {
  if (available.size === 0) {
    if (preferred === 0) return { format: 0, note: null };
    return { format: 0, note: `Format ${preferred} not available, using default` };
  }
  if (available.has(preferred)) return { format: preferred, note: null };
  if (available.has(0)) return { format: 0, note: `Format ${preferred} not available, falling back to default` };
  const fallback = [...available][0];
  return { format: fallback, note: `Format ${preferred} not available, using format ${fallback}` };
}

function resolveDlServer(html, vaultUrl) {
  let dlServer = null;

  const action1 = html.match(FORM_ACTION_1);
  const action2 = html.match(FORM_ACTION_2);
  if (action1) dlServer = action1[1];
  else if (action2) dlServer = action2[1];

  if (!dlServer) {
    const jsAction = html.match(JS_ACTION_RE);
    if (jsAction) dlServer = jsAction[1];
  }
  if (!dlServer) {
    const dlMatch = html.match(DL_SERVER_RE);
    if (dlMatch) dlServer = dlMatch[1];
  }
  if (!dlServer) {
    const prMatch = html.match(DL_SERVER_PROTO_REL_RE);
    if (prMatch) dlServer = `https:${prMatch[1]}`;
  }

  dlServer ??= "https://dl3.vimm.net/";

  const pageUri = new URL(vaultUrl);
  let dlBaseUri;
  if (dlServer.startsWith("//")) {
    dlBaseUri = new URL(`https:${dlServer}`);
  } else if (/^https?:\/\//i.test(dlServer)) {
    dlBaseUri = new URL(dlServer);
  } else {
    dlBaseUri = new URL(dlServer, pageUri);
  }

  if (dlBaseUri.protocol !== "https:") {
    dlBaseUri = new URL(`https://${dlBaseUri.host}${dlBaseUri.pathname}`);
  }

  return `${dlBaseUri.origin}${dlBaseUri.pathname.replace(/\/$/, "")}/`;
}

export function parseVaultPage(html, vaultUrl, preferredFormat = 0) {
  const mediaId = extractMediaId(html);
  if (!mediaId) return null;

  const titleMatch = html.match(TITLE_RE);
  const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : "download";

  const availableFormats = extractAvailableFormats(html);
  const { format: resolvedFormat, note: formatNote } = resolveFormat(preferredFormat, availableFormats);

  const dlServer = resolveDlServer(html, vaultUrl);
  const downloadUrl =
    resolvedFormat > 0
      ? `${dlServer}?mediaId=${mediaId}&alt=${resolvedFormat}`
      : `${dlServer}?mediaId=${mediaId}`;

  return {
    mediaId,
    title,
    downloadUrl,
    dlServer,
    resolvedFormat,
    formatNote,
  };
}

export function vimmVaultHeaders(referrer = "https://vimm.net/") {
  return {
    "User-Agent": VIMM_CHROME_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: referrer,
    "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
  };
}

export function vimmDownloadHeaders(vaultUrl) {
  return {
    "User-Agent": VIMM_CHROME_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: vaultUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    DNT: "1",
  };
}

export async function fetchAndParseVault(vaultUrl, preferredFormat = 0) {
  const pageRes = await fetch(vaultUrl, {
    headers: vimmVaultHeaders("https://vimm.net/"),
    redirect: "follow",
  });

  if (!pageRes.ok) {
    return { ok: false, status: pageRes.status, error: `Vault page HTTP ${pageRes.status}` };
  }

  const html = await pageRes.text();
  const finalVaultUrl = pageRes.url || vaultUrl;
  const parsed = parseVaultPage(html, finalVaultUrl, preferredFormat);

  if (!parsed) {
    return { ok: false, status: 502, error: "Could not find mediaId on vault page" };
  }

  return { ok: true, parsed, vaultUrl: finalVaultUrl };
}

function filenameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain) return plain[1];
  return fallback;
}

const VIMM_SLOT_KEY = "vimm:proxy:slot";
const VIMM_SLOT_TTL_SEC = 2 * 60 * 60;

export async function readVimmProxySlot(kv) {
  if (!kv) return { busy: false, slotId: null };
  const slotId = await kv.get(VIMM_SLOT_KEY);
  return { busy: Boolean(slotId), slotId: slotId ?? null };
}

export async function acquireVimmProxySlot(kv) {
  if (!kv) return { ok: true, slotId: null };
  const slotId = crypto.randomUUID();
  const ok = await kv.put(VIMM_SLOT_KEY, slotId, { expirationTtl: VIMM_SLOT_TTL_SEC, onlyIfAbsent: true });
  if (ok) return { ok: true, slotId };
  const current = await kv.get(VIMM_SLOT_KEY);
  return { ok: false, slotId: current ?? null };
}

export async function releaseVimmProxySlot(kv, slotId) {
  if (!kv || !slotId) return;
  const current = await kv.get(VIMM_SLOT_KEY);
  if (current === slotId) await kv.delete(VIMM_SLOT_KEY);
}

function wrapBodyWithSlotRelease(body, kv, slotId) {
  if (!body || !kv || !slotId) return body;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = body.getReader();
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
      await releaseVimmProxySlot(kv, slotId);
    }
  })();
  return readable;
}

export async function proxyVimmDownload(vaultUrl, request, preferredFormat = 0, kv = null, slotId = null) {
  const resolved = await fetchAndParseVault(vaultUrl, preferredFormat);
  if (!resolved.ok) {
    if (slotId) await releaseVimmProxySlot(kv, slotId);
    return resolved;
  }

  const { parsed, vaultUrl: finalVaultUrl } = resolved;
  const upstreamHeaders = vimmDownloadHeaders(finalVaultUrl);
  const range = request.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  let upstream;
  try {
    upstream = await fetch(parsed.downloadUrl, { headers: upstreamHeaders, redirect: "follow" });
  } catch (error) {
    if (slotId) await releaseVimmProxySlot(kv, slotId);
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "Upstream fetch failed",
    };
  }

  if (!upstream.ok && upstream.status !== 206) {
    if (slotId) await releaseVimmProxySlot(kv, slotId);
    return {
      ok: false,
      status: upstream.status,
      error: `Vimm download HTTP ${upstream.status}`,
      tryOtherWorker: upstream.status === 429,
      retryAfter: upstream.status === 429 ? 60 : undefined,
    };
  }

  const disposition = upstream.headers.get("content-disposition");
  const filename = filenameFromDisposition(disposition, `${parsed.title}.zip`);
  const out = new Headers();
  for (const name of ["content-type", "content-length", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "download.zip";
  out.set(
    "content-disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  const body = wrapBodyWithSlotRelease(upstream.body, kv, slotId);

  return {
    ok: true,
    response: new Response(body, { status: upstream.status, headers: out }),
    meta: parsed,
    vaultUrl: finalVaultUrl,
  };
}

export async function handleVimmTestRequest(request, env, reqUrl, path, helpers) {
  const { jsonResponse, corsHeaders, redirectResponse } = helpers;
  const kv = env.DOWNLOAD_KV ?? null;

  const allowed = new Set([
    "/test/vimm/resolve",
    "/test/vimm/download",
    "/test/vimm/slot",
    "/test/vimm/go",
  ]);
  if (!allowed.has(path)) {
    return jsonResponse(404, { error: "Not found" }, request, env);
  }

  if (path === "/test/vimm/slot") {
    const slot = await readVimmProxySlot(kv);
    return jsonResponse(200, { busy: slot.busy }, request, env);
  }

  const vaultParam = reqUrl.searchParams.get("vault")?.trim();
  const vaultUrl = normalizeVaultUrl(vaultParam);
  if (!vaultUrl) {
    return jsonResponse(400, { error: "Missing or invalid vault (URL or numeric id)" }, request, env);
  }

  const formatRaw = reqUrl.searchParams.get("format");
  const preferredFormat = formatRaw != null ? Number.parseInt(formatRaw, 10) : 0;

  if (path === "/test/vimm/go") {
    return redirectResponse(vaultUrl, request, env);
  }

  if (path === "/test/vimm/resolve") {
    const resolved = await fetchAndParseVault(vaultUrl, preferredFormat);
    if (!resolved.ok) {
      return jsonResponse(resolved.status ?? 502, { error: resolved.error }, request, env);
    }

    const { parsed, vaultUrl: finalVaultUrl } = resolved;
    return jsonResponse(
      200,
      {
        vaultUrl: finalVaultUrl,
        title: parsed.title,
        mediaId: parsed.mediaId,
        downloadUrl: parsed.downloadUrl,
        dlServer: parsed.dlServer,
        format: parsed.resolvedFormat,
        formatNote: parsed.formatNote,
        directVaultUrl: finalVaultUrl,
      },
      request,
      env
    );
  }

  const slot = await acquireVimmProxySlot(kv);
  if (!slot.ok) {
    return jsonResponse(
      429,
      {
        error: "worker_busy",
        message: "This worker already has an active Vimm proxy download. Try another worker.",
        try_other_worker: true,
        retry_after: 30,
      },
      request,
      env
    );
  }

  const proxied = await proxyVimmDownload(vaultUrl, request, preferredFormat, kv, slot.slotId);
  if (!proxied.ok) {
    const payload = {
      error: proxied.error,
      try_other_worker: proxied.tryOtherWorker ?? false,
      retry_after: proxied.retryAfter,
    };
    return jsonResponse(proxied.status ?? 502, payload, request, env);
  }

  for (const [name, value] of corsHeaders(request, env)) {
    proxied.response.headers.set(name, value);
  }
  return proxied.response;
}
