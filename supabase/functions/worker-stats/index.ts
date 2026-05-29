/**
 * Supabase Edge Function: worker-stats
 *
 * Returns Cloudflare Analytics + deployment status for all managed workers.
 * Uses only the CF REST/GraphQL APIs — zero worker invocations consumed.
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
    if ((data as { errors?: unknown }).errors) return null; // missing Analytics permission

    const rows = (data as {
      data?: { viewer?: { accounts?: [{ workersInvocationsAdaptive?: unknown[] }] } }
    })?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

    type Row = { sum?: { requests?: number; errors?: number; subrequests?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number } };
    return (rows as Row[]).reduce(
      (acc, row) => ({
        requests:    acc.requests    + (row.sum?.requests    ?? 0),
        errors:      acc.errors      + (row.sum?.errors      ?? 0),
        subrequests: acc.subrequests + (row.sum?.subrequests ?? 0),
        // CF returns CPU time in microseconds → convert to ms
        cpuP50: row.quantiles?.cpuTimeP50 != null ? row.quantiles.cpuTimeP50 / 1000 : acc.cpuP50,
        cpuP99: row.quantiles?.cpuTimeP99 != null ? row.quantiles.cpuTimeP99 / 1000 : acc.cpuP99,
      }),
      { requests: 0, errors: 0, subrequests: 0, cpuP50: null as number | null, cpuP99: null as number | null }
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CF REST: deployment status (no worker invocations — reads from CF control plane)
// ---------------------------------------------------------------------------

async function fetchDeploymentStatus(accountId: string, apiToken: string, workerName: string) {
  try {
    // This endpoint returns raw JS bytes, not JSON — just check the HTTP status.
    // 200 = script exists, 404 = not found, 403 = token lacks Scripts:Read.
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

  // Auth
  const password = req.headers.get("X-Dashboard-Password") ?? "";
  const expected = Deno.env.get("DASHBOARD_PASSWORD") ?? "";
  if (!expected || password !== expected) {
    return json(401, { error: "Unauthorized" });
  }

  // Parse managed accounts from secret
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

  if (!Array.isArray(accounts) || !accounts.length) {
    return json(200, { workers: [], asOf: new Date().toISOString() });
  }

  // Fetch deployment status + analytics for all workers concurrently
  const workers = await Promise.all(
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
        label:      account.label ?? account.workerName,
        workerName: account.workerName,
        workerUrl:  account.workerUrl ?? null,
        deployment,
        analytics: analytics
          ? { ...analytics, errorRate }
          : null,
        analyticsUnavailable: analytics === null,
      };
    })
  );

  return json(200, { workers, asOf: new Date().toISOString() });
});
