import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

export type Collection = {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CollectionWithCount = Collection & {
  item_count: number;
};

export type CreateCollectionInput = {
  name: string;
  is_public: boolean;
};

export type UpdateCollectionInput = {
  name?: string;
  is_public?: boolean;
};

function isMissingCollectionsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string; status?: number; details?: string };
  const message = `${row.message ?? ""} ${row.details ?? ""}`;
  return (
    row.code === "PGRST205" ||
    row.code === "42P01" ||
    row.status === 404 ||
    /collections.*(does not exist|could not find|not found)/i.test(message)
  );
}

function mapCollection(row: Collection & { collection_items?: { count: number }[] }): CollectionWithCount {
  const count = row.collection_items?.[0]?.count ?? 0;
  const { collection_items: _items, ...collection } = row;
  return { ...collection, item_count: count };
}

export async function loadMyCollections(user: User): Promise<CollectionWithCount[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("collections")
    .select("*, collection_items(count)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingCollectionsTable(error)) {
      console.warn(
        "collections table is missing in Supabase. Apply supabase/migrations/20260527160000_collections.sql (or run supabase db push)."
      );
      return [];
    }
    throw error;
  }

  return (data ?? []).map((row) => mapCollection(row as Collection & { collection_items?: { count: number }[] }));
}

export async function loadPublicCollections(userId: string): Promise<CollectionWithCount[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("collections")
    .select("*, collection_items(count)")
    .eq("user_id", userId)
    .eq("is_public", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingCollectionsTable(error)) return [];
    throw error;
  }

  return (data ?? []).map((row) => mapCollection(row as Collection & { collection_items?: { count: number }[] }));
}

export async function loadCollectionItems(collectionId: string): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("collection_items")
    .select("title_id")
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  if (error) {
    if (isMissingCollectionsTable(error)) return [];
    throw error;
  }

  return (data ?? []).map((row) => row.title_id as string);
}

export async function loadMembershipForTitle(user: User, titleId: string): Promise<Set<string>> {
  const supabase = getSupabase();
  if (!supabase) return new Set();

  const { data, error } = await supabase
    .from("collection_items")
    .select("collection_id, collections!inner(user_id)")
    .eq("title_id", titleId)
    .eq("collections.user_id", user.id);

  if (error) {
    if (isMissingCollectionsTable(error)) return new Set();
    throw error;
  }

  return new Set((data ?? []).map((row) => row.collection_id as string));
}

export async function createCollection(user: User, input: CreateCollectionInput): Promise<Collection> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const name = input.name.trim();
  if (!name) throw new Error("Collection name is required.");

  const { data, error } = await supabase
    .from("collections")
    .insert({
      user_id: user.id,
      name,
      is_public: input.is_public
    })
    .select("*")
    .single();

  if (error) {
    if (isMissingCollectionsTable(error)) {
      throw new Error(
        "Collections are not set up yet. Apply supabase/migrations/20260527160000_collections.sql in your Supabase project."
      );
    }
    if (error.code === "23505") {
      throw new Error("You already have a collection with that name.");
    }
    throw error;
  }

  return data as Collection;
}

export async function addTitleToCollection(collectionId: string, titleId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("collection_items").upsert(
    { collection_id: collectionId, title_id: titleId },
    { onConflict: "collection_id,title_id", ignoreDuplicates: true }
  );

  if (error) {
    if (isMissingCollectionsTable(error)) {
      throw new Error("Collections are not set up yet.");
    }
    throw error;
  }
}

export async function removeTitleFromCollection(collectionId: string, titleId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase
    .from("collection_items")
    .delete()
    .eq("collection_id", collectionId)
    .eq("title_id", titleId);

  if (error) throw error;
}

export async function updateCollection(collectionId: string, input: UpdateCollectionInput): Promise<Collection> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Collection name is required.");
    patch.name = name;
  }
  if (input.is_public !== undefined) patch.is_public = input.is_public;

  const { data, error } = await supabase
    .from("collections")
    .update(patch)
    .eq("id", collectionId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have a collection with that name.");
    }
    throw error;
  }

  return data as Collection;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("collections").delete().eq("id", collectionId);
  if (error) throw error;
}
