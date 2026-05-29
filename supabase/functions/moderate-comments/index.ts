/**
 * Supabase Edge Function: moderate-comments
 *
 * Status dashboard only — requires X-Dashboard-Password (same as /status).
 *
 * GET  /functions/v1/moderate-comments?limit=80
 * DELETE /functions/v1/moderate-comments  { comment_id }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "X-Dashboard-Password, apikey, Authorization, Content-Type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function unauthorized() {
  return json(401, { error: "Unauthorized" });
}

function checkPassword(req: Request): boolean {
  const password = req.headers.get("X-Dashboard-Password") ?? "";
  const expected = Deno.env.get("DASHBOARD_PASSWORD") ?? "";
  return Boolean(expected && password === expected);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!checkPassword(req)) return unauthorized();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return json(500, { error: "Supabase not configured" });
  }

  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    "Content-Type": "application/json",
  };

  if (req.method === "GET") {
    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "80") || 80));

    const res = await fetch(
      `${supabaseUrl}/rest/v1/comment_feed?select=id,title_id,user_id,body,created_at,gamertag,gamerpic_url&order=created_at.desc&limit=${limit}`,
      { headers }
    ).catch(() => null);

    if (!res?.ok) {
      return json(500, { error: "Failed to load comments" });
    }

    const comments = await res.json().catch(() => []);
    return json(200, { comments: Array.isArray(comments) ? comments : [] });
  }

  if (req.method === "DELETE") {
    let body: { comment_id?: string };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const commentId = typeof body.comment_id === "string" ? body.comment_id.trim() : "";
    if (!commentId || !UUID_RE.test(commentId)) {
      return json(400, { error: "Invalid comment_id" });
    }

    const res = await fetch(
      `${supabaseUrl}/rest/v1/game_comments?id=eq.${commentId}`,
      { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
    ).catch(() => null);

    if (!res?.ok) {
      return json(500, { error: "Failed to delete comment" });
    }

    return json(200, { ok: true });
  }

  return json(405, { error: "Method not allowed" });
});
