/**
 * Supabase Edge Function: worker-stats
 *
 * Returns Cloudflare worker analytics + Internet Archive cookie pool status.
 * Uses CF REST/GraphQL for workers and live IA session validation for cookies.
 *
 * Supabase secrets required (set via manage-workers.mjs):
 *   DASHBOARD_PASSWORD   Plain-text password checked on every request
 *   MANAGED_ACCOUNTS     JSON: [{label,accountId,apiToken,workerName,workerUrl}]
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "X-Dashboard-Password, apikey, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

type IaCookieRow = {
  id: string;
  label: string;
  enabled: boolean;
  expires_at: string | null;
  use_count: number;
  error_count: number;
  last_used_at: string | null;
  last_validated_at: string | null;
  is_valid: boolean | null;
  validation_message: string | null;
  user_value: string;
  sig_value: string;
};

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function supabaseConfig() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { url, serviceKey };
}

async function supabaseFetch(path: string, init?: RequestInit) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) return null;
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
}

async function fetchIaCookieRows(): Promise<IaCookieRow[]> {
  const res = await supabaseFetch(
    "/rest/v1/ia_cookie_pool?select=id,label,enabled,expires_at,use_count,error_count,last_used_at,last_validated_at,is_valid,validation_message,user_value,sig_value&order=created_at.asc"
  );
  if (!res?.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows as IaCookieRow[] : [];
}

async function fetchUses24h(cookieIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!cookieIds.length) return out;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filter = `cookie_id=in.(${cookieIds.join(",")})&created_at=gte.${encodeURIComponent(since)}`;
  const res = await supabaseFetch(`/rest/v1/ia_cookie_usage?${filter}&select=cookie_id`);
  if (!res?.ok) return out;

  const rows = await res.json();
  if (!Array.isArray(rows)) return out;
  for (const row of rows as Array<{ cookie_id?: string }>) {
    if (!row.cookie_id) continue;
    out.set(row.cookie_id, (out.get(row.cookie_id) ?? 0) + 1);
  }
  return out;
}

async function fetchErrors24h(cookieIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!cookieIds.length) return out;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filter = `cookie_id=in.(${cookieIds.join(",")})&created_at=gte.${encodeURIComponent(since)}&outcome=neq.ok`;
  const res = await supabaseFetch(`/rest/v1/ia_cookie_usage?${filter}&select=cookie_id`);
  if (!res?.ok) return out;

  const rows = await res.json();
  if (!Array.isArray(rows)) return out;
  for (const row of rows as Array<{ cookie_id?: string }>) {
    if (!row.cookie_id) continue;
    out.set(row.cookie_id, (out.get(row.cookie_id) ?? 0) + 1);
  }
  return out;
}

const IA_VALIDATION_TEST_URL =
  "https://archive.org/download/microsoft_xbox360_a_part1/A%20Ressha%20de%20Ikou%20HX%20(Japan).zip";
const IA_VALIDATION_MAX_REDIRECTS = 8;

async function validateIaCookie(user: string, sig: string) {
  const cookie = `logged-in-user=${user}; logged-in-sig=${sig};`;
  let url = IA_VALIDATION_TEST_URL;
  const headers = { Cookie: cookie, Range: "bytes=0-0" };

  try {
    for (let hop = 0; hop < IA_VALIDATION_MAX_REDIRECTS; hop++) {
      const res = await fetch(url, {
        redirect: "manual",
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        url = new URL(location, url).toString();
        continue;
      }
      if (res.ok || res.status === 206) return { valid: true, message: null as string | null };
      if (res.status === 401 || res.status === 403) {
        return { valid: false, message: `HTTP ${res.status} — session rejected` };
      }
      return { valid: false, message: `HTTP ${res.status}` };
    }
    return { valid: false, message: "Could not resolve Archive download URL" };
  } catch (err) {
    return { valid: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

async function patchCookieValidation(id: string, valid: boolean, message: string | null) {
  await supabaseFetch(`/rest/v1/ia_cookie_pool?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      is_valid: valid,
      last_validated_at: new Date().toISOString(),
      validation_message: message,
    }),
  });
}

async function buildIaCookieStats(rows: IaCookieRow[]) {
  const ids = rows.map((r) => r.id);
  const [uses24h, errors24h] = await Promise.all([
    fetchUses24h(ids),
    fetchErrors24h(ids),
  ]);

  const now = Date.now();
  return Promise.all(
    rows.map(async (row) => {
      let valid = row.is_valid;
      let validationMessage = row.validation_message;
      let lastValidatedAt = row.last_validated_at;

      if (row.enabled) {
        const check = await validateIaCookie(row.user_value, row.sig_value);
        valid = check.valid;
        validationMessage = check.message;
        lastValidatedAt = new Date().toISOString();
        await patchCookieValidation(row.id, check.valid, check.message);
      }

      const expiresAt = row.expires_at;
      const expiredByDate = expiresAt ? new Date(expiresAt).getTime() < now : false;

      return {
        id: row.id,
        label: row.label || row.user_value,
        enabled: row.enabled,
        expiresAt,
        expiredByDate,
        isValid: row.enabled ? valid : null,
        validationMessage: row.enabled ? validationMessage : "Disabled",
        lastValidatedAt,
        useCount: row.use_count ?? 0,
        errorCount: row.error_count ?? 0,
        uses24h: uses24h.get(row.id) ?? 0,
        errors24h: errors24h.get(row.id) ?? 0,
        lastUsedAt: row.last_used_at,
      };
    })
  );
}

// ---------------------------------------------------------------------------
// CF Analytics GraphQL (no worker invocations — reads from CF data store)
// ---------------------------------------------------------------------------

async function fetchAnalytics(accountId: string, apiToken: string, workerName: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();

  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        workersInvocationsAdaptive(
          limit: 10000
          filter: {
            scriptName: "${workerName}"
            datetime_geq: "${since}"
            datetime_leq: "${until}"
          }
        ) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
        }
      }
    }
  }`;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    if ((data as { errors?: unknown }).errors) return null;

    const rows = (data as {
      data?: { viewer?: { accounts?: [{ workersInvocationsAdaptive?: unknown[] }] } }
    })?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

    type Row = { sum?: { requests?: number; errors?: number; subrequests?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number } };
    return (rows as Row[]).reduce(
      (acc, row) => ({
        requests:    acc.requests    + (row.sum?.requests    ?? 0),
        errors:      acc.errors      + (row.sum?.errors      ?? 0),
        subrequests: acc.subrequests + (row.sum?.subrequests ?? 0),
        cpuP50: row.quantiles?.cpuTimeP50 != null ? row.quantiles.cpuTimeP50 / 1000 : acc.cpuP50,
        cpuP99: row.quantiles?.cpuTimeP99 != null ? row.quantiles.cpuTimeP99 / 1000 : acc.cpuP99,
      }),
      { requests: 0, errors: 0, subrequests: 0, cpuP50: null as number | null, cpuP99: null as number | null }
    );
  } catch {
    return null;
  }
}

async function fetchDeploymentStatus(accountId: string, apiToken: string, workerName: string) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
      {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    return { deployed: res.ok, httpStatus: res.status };
  } catch {
    return { deployed: false, httpStatus: null };
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const password = req.headers.get("X-Dashboard-Password") ?? "";
  const expected = Deno.env.get("DASHBOARD_PASSWORD") ?? "";
  if (!expected || password !== expected) {
    return json(401, { error: "Unauthorized" });
  }

  let accounts: Array<{
    label: string;
    accountId: string;
    apiToken: string;
    workerName: string;
    workerUrl: string | null;
  }>;
  try {
    accounts = JSON.parse(Deno.env.get("MANAGED_ACCOUNTS") ?? "[]");
  } catch {
    return json(500, { error: "MANAGED_ACCOUNTS secret is invalid JSON" });
  }

  const [workers, iaCookies] = await Promise.all([
    Array.isArray(accounts) && accounts.length
      ? Promise.all(
          accounts.map(async (account) => {
            const [deployment, analytics] = await Promise.all([
              fetchDeploymentStatus(account.accountId, account.apiToken, account.workerName),
              fetchAnalytics(account.accountId, account.apiToken, account.workerName),
            ]);

            const errorRate =
              analytics && analytics.requests > 0
                ? parseFloat(((analytics.errors / analytics.requests) * 100).toFixed(2))
                : 0;

            return {
              label: account.label ?? account.workerName,
              workerName: account.workerName,
              workerUrl: account.workerUrl ?? null,
              deployment,
              analytics: analytics ? { ...analytics, errorRate } : null,
              analyticsUnavailable: analytics === null,
            };
          })
        )
      : Promise.resolve([]),
    buildIaCookieStats(await fetchIaCookieRows()),
  ]);

  return json(200, { workers, iaCookies, asOf: new Date().toISOString() });
});
