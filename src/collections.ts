import type { User } from "@supabase/supabase-js";
import { sanitizeCollectionDescription, sanitizeCollectionName } from "./sanitize";
import { getSupabase } from "./supabase";

export type Collection = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CollectionWithCount = Collection & {
  item_count: number;
};

export type DiscoverCollection = CollectionWithCount & {
  owner_gamertag: string;
  owner_gamerpic_url: string | null;
  preview_title_ids: string[];
};

export const COLLECTION_DESCRIPTION_MAX_LEN = 280;

function notifyCollectionsChanged(): void {
  window.dispatchEvent(new CustomEvent("xbx-collections-changed"));
}

export type CreateCollectionInput = {
  name: string;
  description?: string | null;
  is_public: boolean;
};

export type UpdateCollectionInput = {
  name?: string;
  description?: string | null;
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
  return { ...collection, description: collection.description ?? null, item_count: count };
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

function previewTitleIdsByCollection(
  rows: { collection_id: string; title_id: string; added_at: string }[]
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const list = grouped.get(row.collection_id) ?? [];
    if (list.length >= 4) continue;
    list.push(row.title_id);
    grouped.set(row.collection_id, list);
  }
  return grouped;
}

export async function loadCollectionPreviewIds(collectionIds: string[]): Promise<Map<string, string[]>> {
  if (!collectionIds.length) return new Map();
  const supabase = getSupabase();
  if (!supabase) return new Map();

  const { data, error } = await supabase
    .from("collection_items")
    .select("collection_id, title_id, added_at")
    .in("collection_id", collectionIds)
    .order("added_at", { ascending: false });

  if (error) {
    if (isMissingCollectionsTable(error)) return new Map();
    throw error;
  }

  return previewTitleIdsByCollection(
    (data ?? []) as { collection_id: string; title_id: string; added_at: string }[]
  );
}

export async function loadDiscoverPublicCollections(): Promise<DiscoverCollection[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("collections")
    .select("*, collection_items(count)")
    .eq("is_public", true)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingCollectionsTable(error)) return [];
    throw error;
  }

  const collections = (data ?? []).map((row) =>
    mapCollection(row as Collection & { collection_items?: { count: number }[] })
  );
  if (!collections.length) return [];

  const userIds = [...new Set(collections.map((row) => row.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("public_profiles")
    .select("id, gamertag, gamerpic_url")
    .in("id", userIds);

  if (profileError && !isMissingCollectionsTable(profileError)) {
    throw profileError;
  }

  const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]));

  const collectionIds = collections.map((row) => row.id);
  const { data: items, error: itemsError } = await supabase
    .from("collection_items")
    .select("collection_id, title_id, added_at")
    .in("collection_id", collectionIds)
    .order("added_at", { ascending: false });

  if (itemsError && !isMissingCollectionsTable(itemsError)) {
    throw itemsError;
  }

  const previews = previewTitleIdsByCollection(
    (items ?? []) as { collection_id: string; title_id: string; added_at: string }[]
  );

  return collections.map((collection) => {
    const owner = profileById.get(collection.user_id);
    return {
      ...collection,
      owner_gamertag: (owner?.gamertag as string | undefined)?.trim() || "Player",
      owner_gamerpic_url: (owner?.gamerpic_url as string | null | undefined) ?? null,
      preview_title_ids: previews.get(collection.id) ?? []
    };
  });
}

async function attachOwnerProfiles<T extends CollectionWithCount>(
  collections: T[]
): Promise<(T & { owner_gamertag: string; owner_gamerpic_url: string | null })[]> {
  const supabase = getSupabase();
  if (!supabase || !collections.length) {
    return collections.map((collection) => ({
      ...collection,
      owner_gamertag: "Player",
      owner_gamerpic_url: null
    }));
  }

  const userIds = [...new Set(collections.map((row) => row.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("public_profiles")
    .select("id, gamertag, gamerpic_url")
    .in("id", userIds);

  if (profileError && !isMissingCollectionsTable(profileError)) {
    throw profileError;
  }

  const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]));
  return collections.map((collection) => {
    const owner = profileById.get(collection.user_id);
    return {
      ...collection,
      owner_gamertag: (owner?.gamertag as string | undefined)?.trim() || "Player",
      owner_gamerpic_url: (owner?.gamerpic_url as string | null | undefined) ?? null
    };
  });
}

export async function loadPublicCollectionById(collectionId: string): Promise<DiscoverCollection | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("collections")
    .select("*, collection_items(count)")
    .eq("id", collectionId)
    .eq("is_public", true)
    .maybeSingle();

  if (error) {
    if (isMissingCollectionsTable(error)) return null;
    throw error;
  }
  if (!data) return null;

  const collection = mapCollection(data as Collection & { collection_items?: { count: number }[] });
  const withOwner = (await attachOwnerProfiles([collection]))[0];
  if (!withOwner) return null;

  const { data: items, error: itemsError } = await supabase
    .from("collection_items")
    .select("title_id")
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false })
    .limit(4);

  if (itemsError && !isMissingCollectionsTable(itemsError)) {
    throw itemsError;
  }

  return {
    ...withOwner,
    preview_title_ids: (items ?? []).map((row) => row.title_id as string)
  };
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

  const name = sanitizeCollectionName(input.name);
  if (!name) throw new Error("Collection name is required.");
  const description = sanitizeCollectionDescription(input.description);

  const { data, error } = await supabase
    .from("collections")
    .insert({
      user_id: user.id,
      name,
      description,
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

  notifyCollectionsChanged();
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
  notifyCollectionsChanged();
}

export async function updateCollection(collectionId: string, input: UpdateCollectionInput): Promise<Collection> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = sanitizeCollectionName(input.name);
    if (!name) throw new Error("Collection name is required.");
    patch.name = name;
  }
  if (input.is_public !== undefined) patch.is_public = input.is_public;
  if (input.description !== undefined) {
    patch.description = sanitizeCollectionDescription(input.description);
  }

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

  notifyCollectionsChanged();
  return data as Collection;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error } = await supabase.from("collections").delete().eq("id", collectionId);
  if (error) throw error;
  notifyCollectionsChanged();
}
