/**
 * Supabase Edge Function: report-game
 *
 * Receives user-submitted game issue reports, stores them in game_reports,
 * and forwards to Discord (same webhook as log-event).
 *
 * POST /functions/v1/report-game
 * Body: { title_id, title_name, reason, details?, file_label?, page_url? }
 * Auth: anon key (client-callable from the browser)
 *
 * Supabase secret required:
 *   DISCORD_WEBHOOK_URL
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, Authorization, Content-Type",
};

const REASONS = new Set([
  "broken_download",
  "wrong_game",
  "missing_files",
  "bad_metadata",
  "other",
]);

const REASON_LABELS: Record<string, string> = {
  broken_download: "Broken or failed download",
  wrong_game: "Wrong game / mismatched files",
  missing_files: "Missing DLC, updates, or files",
  bad_metadata: "Wrong title, cover, or description",
  other: "Other issue",
};

const COOLDOWN_MINUTES = 3;

const TITLE_ID_RE = /^[0-9A-Za-z]{4,64}$/;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (value == null || typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    title_id?: string;
    title_name?: string;
    reason?: string;
    details?: string;
    file_label?: string;
    page_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const titleId = cleanText(body.title_id, 64);
  const titleName = cleanText(body.title_name, 200);
  const reason = cleanText(body.reason, 32);
  if (!titleId || !titleName || !reason) {
    return json(400, { error: "Missing title_id, title_name, or reason" });
  }
  if (!TITLE_ID_RE.test(titleId)) return json(400, { error: "Invalid title_id" });
  if (!REASONS.has(reason)) return json(400, { error: "Invalid reason" });

  const details = cleanText(body.details, 500);
  const fileLabel = cleanText(body.file_label, 200);
  let pageUrl = cleanText(body.page_url, 500);
  if (pageUrl && !/^https?:\/\//i.test(pageUrl)) pageUrl = null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL") ?? "";

  const dbHeaders = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  let shouldNotify = false;
  if (webhookUrl && supabaseUrl && serviceRole) {
    const since = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();
    const recentRes = await fetch(
      `${supabaseUrl}/rest/v1/game_reports?title_id=eq.${encodeURIComponent(titleId)}&reason=eq.${encodeURIComponent(reason)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers: dbHeaders }
    ).catch(() => null);

    const recent = recentRes?.ok ? await recentRes.json().catch(() => []) : [];
    shouldNotify = Array.isArray(recent) && recent.length === 0;
  }

  if (supabaseUrl && serviceRole) {
    await fetch(`${supabaseUrl}/rest/v1/game_reports`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        title_id: titleId,
        title_name: titleName,
        reason,
        details,
        file_label: fileLabel,
        page_url: pageUrl,
      }),
    }).catch(() => {});
  }

  if (shouldNotify && webhookUrl) {
    const reasonLabel = REASON_LABELS[reason] ?? reason;
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: "Game", value: titleName.slice(0, 256), inline: true },
      { name: "Title ID", value: `\`${titleId}\``, inline: true },
      { name: "Issue", value: reasonLabel, inline: false },
    ];
    if (fileLabel) fields.push({ name: "File", value: fileLabel.slice(0, 1024), inline: false });
    if (details) fields.push({ name: "Details", value: details.slice(0, 1024), inline: false });
    if (pageUrl) fields.push({ name: "Page", value: pageUrl.slice(0, 1024), inline: false });

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🎮 Game report",
          color: 0x5865f2,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: "xbx.place · xbx-reports" },
        }],
      }),
    }).catch(() => {});
  }

  return json(200, { ok: true, notified: shouldNotify });
});
