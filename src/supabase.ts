import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

function hasPlaceholderValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("xxxx") || normalized.includes("your_project") || normalized.includes("...");
}

function hasValidSupabaseUrl(value: string): boolean {
  if (!value || hasPlaceholderValue(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export const supabaseConfigured = hasValidSupabaseUrl(url) && Boolean(anonKey) && !hasPlaceholderValue(anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
  return client;
}
