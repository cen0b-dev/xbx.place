import type { User } from "@supabase/supabase-js";
import { sanitizeCommentBody } from "./sanitize";
import { getSupabase } from "./supabase";

export type CollectionComment = {
  id: string;
  collection_id: string;
  user_id: string;
  body: string;
  created_at: string;
  gamertag: string;
  gamerpic_url: string | null;
};

export const COLLECTION_COMMENT_MAX_LEN = 500;
export const COLLECTION_COMMENTS_PAGE_SIZE = 20;

function isMissingCollectionCommentsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string; status?: number; details?: string };
  const message = `${row.message ?? ""} ${row.details ?? ""}`;
  return (
    row.code === "PGRST205" ||
    row.code === "42P01" ||
    row.status === 404 ||
    /collection_comments.*(does not exist|could not find|not found)/i.test(message) ||
    /collection_comment_feed.*(does not exist|could not find|not found)/i.test(message)
  );
}

export async function loadCollectionComments(collectionId: string, page = 0): Promise<CollectionComment[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const from = page * COLLECTION_COMMENTS_PAGE_SIZE;
  const to = from + COLLECTION_COMMENTS_PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("collection_comment_feed")
    .select("*")
    .eq("collection_id", collectionId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    if (isMissingCollectionCommentsTable(error)) {
      console.warn(
        "collection_comments table is missing. Apply supabase/migrations/20260529130000_collection_descriptions_comments.sql."
      );
      return [];
    }
    throw error;
  }

  return (data ?? []) as CollectionComment[];
}

export async function postCollectionComment(
  user: User,
  collectionId: string,
  body: string
): Promise<CollectionComment | null> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const sanitized = sanitizeCommentBody(body);
  if (!sanitized) throw new Error("Comment cannot be empty.");

  const { data: inserted, error } = await supabase
    .from("collection_comments")
    .insert({ collection_id: collectionId, user_id: user.id, body: sanitized })
    .select("id")
    .single();

  if (error) {
    if (isMissingCollectionCommentsTable(error)) {
      throw new Error("Collection comments are not set up yet.");
    }
    throw error;
  }

  const { data: full, error: fetchErr } = await supabase
    .from("collection_comment_feed")
    .select("*")
    .eq("id", (inserted as { id: string }).id)
    .single();

  if (fetchErr || !full) return null;
  return full as CollectionComment;
}

export async function deleteCollectionComment(commentId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("collection_comments").delete().eq("id", commentId);
  if (error) throw error;
}
