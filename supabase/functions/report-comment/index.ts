/**
 * Supabase Edge Function: report-comment
 *
 * POST /functions/v1/report-comment
 * Body: { comment_id, title_id, title_name, reason, details?, comment_excerpt?, page_url? }
 * Auth: anon key (optional user JWT for reporter_user_id)
 *
 * Supabase secret: DISCORD_WEBHOOK_URL
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, Authorization, Content-Type",
};

const REASONS = new Set(["spam", "harassment", "off_topic", "other"]);

const REASON_LABELS: Record<string, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or abuse",
  off_topic: "Off-topic or unrelated",
  other: "Other",
};

const COOLDOWN_MINUTES = 3;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

async function reporterUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !token) return null;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  }).catch(() => null);
  if (!res?.ok) return null;
  const user = await res.json().catch(() => null);
  const id = user?.id;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    comment_id?: string;
    title_id?: string;
    title_name?: string;
    reason?: string;
    details?: string;
    comment_excerpt?: string;
    page_url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const commentId = cleanText(body.comment_id, 64);
  const titleId = cleanText(body.title_id, 64);
  const titleName = cleanText(body.title_name, 200);
  const reason = cleanText(body.reason, 32);
  if (!commentId || !titleId || !titleName || !reason) {
    return json(400, { error: "Missing comment_id, title_id, title_name, or reason" });
  }
  if (!UUID_RE.test(commentId)) return json(400, { error: "Invalid comment_id" });
  if (!TITLE_ID_RE.test(titleId)) return json(400, { error: "Invalid title_id" });
  if (!REASONS.has(reason)) return json(400, { error: "Invalid reason" });

  const details = cleanText(body.details, 500);
  const excerpt = cleanText(body.comment_excerpt, 280);
  let pageUrl = cleanText(body.page_url, 500);
  if (pageUrl && !/^https?:\/\//i.test(pageUrl)) pageUrl = null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL") ?? "";
  const reporterId = await reporterUserId(req);

  const dbHeaders = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const commentRes = await fetch(
    `${supabaseUrl}/rest/v1/game_comments?id=eq.${commentId}&select=id&limit=1`,
    { headers: dbHeaders }
  ).catch(() => null);
  const commentRows = commentRes?.ok ? await commentRes.json().catch(() => []) : [];
  if (!Array.isArray(commentRows) || commentRows.length === 0) {
    return json(404, { error: "Comment not found" });
  }

  let shouldNotify = false;
  if (webhookUrl && supabaseUrl && serviceRole) {
    const since = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();
    const recentRes = await fetch(
      `${supabaseUrl}/rest/v1/comment_reports?comment_id=eq.${encodeURIComponent(commentId)}&reason=eq.${encodeURIComponent(reason)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers: dbHeaders }
    ).catch(() => null);
    const recent = recentRes?.ok ? await recentRes.json().catch(() => []) : [];
    shouldNotify = Array.isArray(recent) && recent.length === 0;
  }

  if (supabaseUrl && serviceRole) {
    await fetch(`${supabaseUrl}/rest/v1/comment_reports`, {
      method: "POST",
      headers: dbHeaders,
      body: JSON.stringify({
        comment_id: commentId,
        title_id: titleId,
        title_name: titleName,
        reason,
        details,
        comment_excerpt: excerpt,
        reporter_user_id: reporterId,
        page_url: pageUrl,
      }),
    }).catch(() => {});
  }

  if (shouldNotify && webhookUrl) {
    const reasonLabel = REASON_LABELS[reason] ?? reason;
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: "Game", value: titleName.slice(0, 256), inline: true },
      { name: "Comment ID", value: `\`${commentId.slice(0, 36)}\``, inline: true },
      { name: "Issue", value: reasonLabel, inline: false },
    ];
    if (excerpt) fields.push({ name: "Comment", value: excerpt.slice(0, 1024), inline: false });
    if (details) fields.push({ name: "Details", value: details.slice(0, 1024), inline: false });
    if (pageUrl) fields.push({ name: "Page", value: pageUrl.slice(0, 1024), inline: false });

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "💬 Comment report",
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
