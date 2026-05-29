/**
 * Supabase Edge Function: log-event
 *
 * Receives client-reported download events, inserts them into worker_events,
 * and forwards to Discord — with a per-type cooldown so the same error can't
 * spam the channel.
 *
 * POST /functions/v1/log-event
 * Body: { type, worker_url?, message? }
 * Auth: anon key (client-callable from the browser)
 *
 * Supabase secret required:
 *   DISCORD_WEBHOOK_URL   (set via: npx supabase secrets set DISCORD_WEBHOOK_URL=https://...)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, Authorization, Content-Type",
};

// Minutes of silence after an alert before the same type fires again.
const COOLDOWN_MINUTES: Record<string, number> = {
  worker_rate_limited: 10,
  all_workers_down:    5,
  ia_resolve_failed:   5,
  ia_cookie_empty:     30,
};

const EMBEDS: Record<string, { title: string; color: number }> = {
  worker_rate_limited: { title: "🟡 Worker Rate Limited / Error",   color: 0xfee75c },
  all_workers_down:    { title: "🔴 All Workers Down",              color: 0xed4245 },
  ia_resolve_failed:   { title: "🟠 IA URL Resolution Failed",      color: 0xe67e22 },
  ia_cookie_empty:     { title: "🔴 IA Cookie Pool Empty",          color: 0xed4245 },
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: { type?: string; worker_url?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const { type, worker_url, message } = body;
  if (!type || typeof type !== "string") return json(400, { error: "Missing type" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookUrl  = Deno.env.get("DISCORD_WEBHOOK_URL") ?? "";

  const dbHeaders = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  // -------------------------------------------------------------------------
  // Cooldown check — query BEFORE inserting so the count reflects prior events
  // -------------------------------------------------------------------------
  let shouldNotify = false;
  if (webhookUrl && supabaseUrl && serviceRole) {
    const cooldownMinutes = COOLDOWN_MINUTES[type] ?? 5;
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();

    const recentRes = await fetch(
      `${supabaseUrl}/rest/v1/worker_events?type=eq.${encodeURIComponent(type)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers: dbHeaders }
    ).catch(() => null);

    const recent = recentRes?.ok ? await recentRes.json().catch(() => []) : [];
    shouldNotify = Array.isArray(recent) && recent.length === 0;
  }

  // -------------------------------------------------------------------------
  // Insert event row (best-effort — don't fail the request if table is missing)
  // -------------------------------------------------------------------------
  if (supabaseUrl && serviceRole) {
    await fetch(`${supabaseUrl}/rest/v1/worker_events`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({ type, worker_url: worker_url ?? null, message: message ?? null }),
    }).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Discord alert
  // -------------------------------------------------------------------------
  if (shouldNotify) {
    const embed = EMBEDS[type] ?? { title: `⚠️ ${type}`, color: 0x99aab5 };
    const lines: string[] = [];
    if (worker_url) lines.push(`**Worker:** \`${worker_url}\``);
    if (message)    lines.push(`**Detail:** ${message}`);

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: embed.title,
          description: lines.join("\n") || undefined,
          color: embed.color,
          timestamp: new Date().toISOString(),
          footer: { text: "xbx.place" },
        }],
      }),
    }).catch(() => {});
  }

  return json(200, { ok: true });
});
