import type { User } from "@supabase/supabase-js";
import { sanitizeCommentBody } from "./sanitize";
import { getSupabase } from "./supabase";

export type GameComment = {
  id: string;
  title_id: string;
  user_id: string;
  body: string;
  created_at: string;
  gamertag: string;
  gamerpic_url: string | null;
};

export const COMMENT_MAX_LEN = 500;
export const COMMENTS_PAGE_SIZE = 20;

function isMissingCommentsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string; status?: number; details?: string };
  const message = `${row.message ?? ""} ${row.details ?? ""}`;
  return (
    row.code === "PGRST205" ||
    row.code === "42P01" ||
    row.status === 404 ||
    /game_comments.*(does not exist|could not find|not found)/i.test(message) ||
    /comment_feed.*(does not exist|could not find|not found)/i.test(message)
  );
}

export async function loadComments(titleId: string, page = 0): Promise<GameComment[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const from = page * COMMENTS_PAGE_SIZE;
  const to = from + COMMENTS_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("comment_feed")
    .select("*")
    .eq("title_id", titleId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    if (isMissingCommentsTable(error)) {
      console.warn(
        "game_comments table is missing. Apply supabase/migrations/20260529070000_game_comments.sql (or run supabase db push)."
      );
      return [];
    }
    throw error;
  }

  return (data ?? []) as GameComment[];
}

export async function postComment(user: User, titleId: string, body: string): Promise<GameComment | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const sanitized = sanitizeCommentBody(body);
  if (!sanitized) throw new Error("Comment cannot be empty.");

  const { data: inserted, error } = await supabase
    .from("game_comments")
    .insert({ title_id: titleId, user_id: user.id, body: sanitized })
    .select("id")
    .single();

  if (error) {
    if (isMissingCommentsTable(error)) {
      throw new Error(
        "Comments are not set up yet. Apply supabase/migrations/20260529070000_game_comments.sql in your Supabase project."
      );
    }
    throw error;
  }

  const { data: full, error: fetchErr } = await supabase
    .from("comment_feed")
    .select("*")
    .eq("id", (inserted as { id: string }).id)
    .single();

  if (fetchErr || !full) return null;
  return full as GameComment;
}

export async function deleteComment(commentId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("game_comments").delete().eq("id", commentId);
  if (error) throw error;
}
