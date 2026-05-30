/**
 * Client-side proxy pool for Cloudflare download-proxy workers.
 *
 * The pool is fetched at runtime from the Supabase `worker_pool` table so
 * adding/removing workers takes effect immediately without a rebuild.
 */

const COOLOFF_MS = 5 * 60 * 1000;
const LAST_WORKER_KEY = "xbx_last_worker_origin";

/** Fire-and-forget event to the log-event Edge Function. */
export function notifyEvent(type: string, workerUrl?: string, message?: string): void {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!supabaseUrl || !supabaseKey) return;
  fetch(`${supabaseUrl}/functions/v1/log-event`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ type, worker_url: workerUrl, message }),
  }).catch(() => {});
}

type WorkerHealth = { coolingUntil: number };
const healthMap = new Map<string, WorkerHealth>();
let pool: string[] = [];
let poolPromise: Promise<void> | null = null;
let lastWorkerIndex = -1;

function readSessionLastOrigin(): string | null {
  try {
    return sessionStorage.getItem(LAST_WORKER_KEY);
  } catch {
    return null;
  }
}

function writeSessionLastOrigin(origin: string): void {
  try {
    sessionStorage.setItem(LAST_WORKER_KEY, origin);
  } catch {
    /* private mode */
  }
}

function pickRoundRobin(candidates: string[], afterOrigin?: string): string | null {
  if (!candidates.length) return null;

  let startPos = -1;
  if (afterOrigin) {
    startPos = candidates.indexOf(afterOrigin);
  } else {
    const lastOrigin = readSessionLastOrigin();
    if (lastOrigin) {
      startPos = candidates.indexOf(lastOrigin);
    } else if (lastWorkerIndex >= 0 && lastWorkerIndex < pool.length) {
      startPos = candidates.indexOf(pool[lastWorkerIndex]!);
    }
  }

  for (let step = 1; step <= candidates.length; step += 1) {
    const idx = (startPos + step) % candidates.length;
    const origin = candidates[idx];
    if (!origin) continue;
    lastWorkerIndex = pool.indexOf(origin);
    writeSessionLastOrigin(origin);
    return origin;
  }

  return null;
}

async function fetchFromSupabase(): Promise<string[]> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (!supabaseUrl || !supabaseKey) return [];

  const res = await fetch(
    `${supabaseUrl}/rest/v1/worker_pool?enabled=eq.true&select=url&order=created_at.asc`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ url: string }>;
  return rows.map((r) => r.url.replace(/\/+$/, "")).filter(Boolean);
}

function envFallbackPool(): string[] {
  return [];
}

/** Call once during app bootstrap. Resolves when the pool is ready. */
export function initProxyPool(): Promise<void> {
  if (!poolPromise) {
    poolPromise = fetchFromSupabase()
      .then((urls) => { pool = urls.length ? urls : envFallbackPool(); })
      .catch(() => { pool = envFallbackPool(); });
  }
  return poolPromise;
}

function isHealthy(origin: string): boolean {
  const entry = healthMap.get(origin);
  return !entry || Date.now() > entry.coolingUntil;
}

/** True if at least one healthy worker is available. */
export function hasProxy(): boolean {
  return pool.some(isHealthy);
}

/**
 * Pick the next healthy worker in pool order (round-robin).
 * Falls back to any worker if all are cooling.
 */
export function pickProxy(): string | null {
  if (!pool.length) return null;
  const healthy = pool.filter(isHealthy);
  const candidates = healthy.length ? healthy : [...pool];
  return pickRoundRobin(candidates);
}

/**
 * Pick the next healthy worker after `exclude` in rotation order.
 * Returns null when no alternative is available.
 */
export function pickNextProxy(exclude: string): string | null {
  const healthy = pool.filter((o) => o !== exclude && isHealthy(o));
  if (!healthy.length) return null;
  return pickRoundRobin(healthy, exclude);
}

/** Mark a worker as rate-limited/erroring; it will be skipped for COOLOFF_MS. */
export function reportProxyRateLimit(origin: string, message?: string): void {
  healthMap.set(origin, { coolingUntil: Date.now() + COOLOFF_MS });
  notifyEvent("worker_rate_limited", origin, message);
}
