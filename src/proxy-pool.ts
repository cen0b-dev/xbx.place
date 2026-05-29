/**
 * Client-side proxy pool for Cloudflare download-proxy workers.
 *
 * The pool is fetched at runtime from the Supabase `worker_pool` table so
 * adding/removing workers takes effect immediately without a rebuild.
 */

const COOLOFF_MS = 5 * 60 * 1000;

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
 * Pick a random healthy worker. Falls back to any worker if all are cooling.
 */
export function pickProxy(): string | null {
  if (!pool.length) return null;
  const healthy = pool.filter(isHealthy);
  const candidates = healthy.length ? healthy : [...pool];
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

/**
 * Pick a healthy worker that is NOT the excluded origin.
 * Returns null when no alternative is available.
 */
export function pickNextProxy(exclude: string): string | null {
  const healthy = pool.filter((o) => o !== exclude && isHealthy(o));
  if (!healthy.length) return null;
  return healthy[Math.floor(Math.random() * healthy.length)] ?? null;
}

/** Mark a worker as rate-limited/erroring; it will be skipped for COOLOFF_MS. */
export function reportProxyRateLimit(origin: string, message?: string): void {
  healthMap.set(origin, { coolingUntil: Date.now() + COOLOFF_MS });
  notifyEvent("worker_rate_limited", origin, message);
}
