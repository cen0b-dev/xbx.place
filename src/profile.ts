import type { User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

export type Profile = {
  id: string;
  email: string | null;
  gamertag: string;
  gamerpic_url: string | null;
  banner_url: string | null;
  bio: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProfileInput = {
  gamertag: string;
  gamerpic_url: string | null;
  banner_url: string | null;
  bio: string | null;
};

export type PublicProfile = {
  id: string;
  gamertag: string;
  gamerpic_url: string | null;
  banner_url: string | null;
  bio: string | null;
  created_at?: string;
};

const fallbackPics = [
  "https://api.dicebear.com/9.x/shapes/svg?seed=xbox-green",
  "https://api.dicebear.com/9.x/shapes/svg?seed=halo",
  "https://api.dicebear.com/9.x/shapes/svg?seed=arcade",
  "https://api.dicebear.com/9.x/shapes/svg?seed=controller"
];

export function fallbackGamerpic(seed: string | null | undefined): string {
  const source = seed || "new-player";
  let total = 0;
  for (let i = 0; i < source.length; i += 1) {
    total += source.charCodeAt(i);
  }
  return fallbackPics[total % fallbackPics.length] ?? "https://api.dicebear.com/9.x/shapes/svg?seed=new-player";
}

export function profileImage(profile: Profile | null, user: User | null): string {
  return profile?.gamerpic_url || fallbackGamerpic(profile?.gamertag ?? user?.email);
}

export function profileName(profile: Profile | null, user: User | null): string {
  return profile?.gamertag?.trim() || user?.email?.split("@")[0] || "Player";
}

function fallbackProfileFromUser(user: User): Profile {
  return {
    id: user.id,
    email: user.email ?? null,
    gamertag: user.email?.split("@")[0] || "New Player",
    gamerpic_url: null,
    banner_url: null,
    bio: null
  };
}

function isMissingProfilesTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: string; message?: string; status?: number; details?: string };
  const message = `${row.message ?? ""} ${row.details ?? ""}`;
  return (
    row.code === "PGRST205" ||
    row.code === "42P01" ||
    row.status === 404 ||
    /profiles.*(does not exist|could not find|not found)/i.test(message)
  );
}

export async function loadProfile(user: User): Promise<Profile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) {
    if (isMissingProfilesTable(error)) {
      console.warn(
        "profiles table is missing in Supabase. Apply supabase/migrations/20260527133000_profiles.sql (or run supabase db push)."
      );
      return fallbackProfileFromUser(user);
    }
    throw error;
  }
  if (data) return data as Profile;

  return saveProfile(user, {
    gamertag: user.email?.split("@")[0] || "New Player",
    gamerpic_url: null,
    banner_url: null,
    bio: null
  });
}

export async function saveProfile(user: User, input: ProfileInput): Promise<Profile> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const row = {
    id: user.id,
    email: user.email ?? null,
    gamertag: input.gamertag.trim() || "New Player",
    gamerpic_url: input.gamerpic_url?.trim() || null,
    banner_url: input.banner_url?.trim() || null,
    bio: input.bio?.trim() || null
  };

  const { data, error } = await supabase.from("profiles").upsert(row, { onConflict: "id" }).select("*").single();
  if (error) {
    if (isMissingProfilesTable(error)) {
      throw new Error(
        "Profile storage is not set up yet. Apply supabase/migrations/20260527133000_profiles.sql in your Supabase project."
      );
    }
    if (error.code === "23505") {
      throw new Error("That gamertag is already taken. Choose another.");
    }
    throw error;
  }
  return data as Profile;
}

export async function loadPublicProfileByGamertag(gamertag: string): Promise<PublicProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const needle = gamertag.trim();
  if (!needle || needle.toLowerCase() === "me") return null;

  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, gamertag, gamerpic_url, banner_url, bio, created_at")
    .ilike("gamertag", needle)
    .maybeSingle();

  if (error) {
    if (isMissingProfilesTable(error)) return null;
    throw error;
  }

  return (data as PublicProfile | null) ?? null;
}
