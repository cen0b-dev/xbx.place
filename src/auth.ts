import type { Session, User } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "./supabase";

export type AuthMode = "sign-in" | "sign-up";

type AuthListener = (user: User | null) => void;

let currentUser: User | null = null;
const listeners = new Set<AuthListener>();

export function isAuthenticated(): boolean {
  return currentUser !== null;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

export function onAuthChange(listener: AuthListener): () => void {
  listeners.add(listener);
  listener(currentUser);
  return () => listeners.delete(listener);
}

function notifyAuthChange(user: User | null): void {
  currentUser = user;
  for (const listener of listeners) {
    listener(user);
  }
}

function authRedirectUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export async function initAuth(): Promise<User | null> {
  const supabase = getSupabase();
  if (!supabase) {
    notifyAuthChange(null);
    return null;
  }

  const { data } = await supabase.auth.getSession();
  notifyAuthChange(data.session?.user ?? null);

  supabase.auth.onAuthStateChange((_event, session) => {
    notifyAuthChange(session?.user ?? null);
  });

  return currentUser;
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Supabase is not configured.";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error?.message ?? null;
}

export async function signUpWithPassword(email: string, password: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Supabase is not configured.";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectUrl() }
  });
  if (error) return error.message;
  if (data.session) return null;
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError?.message.toLowerCase().includes("email not confirmed")) {
    return "Account created, but Supabase is requiring email confirmation before sign-in. Disable Confirm email in Supabase Authentication > Providers > Email to sign users in automatically.";
  }
  return signInError?.message ?? null;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function authAvailable(): boolean {
  return supabaseConfigured;
}

export type { Session, User };
