#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PAUSE_ON_EXIT="${PAUSE_ON_EXIT:-0}"

say() {
  printf '%s\n' "$*"
}

fail() {
  say ""
  say "ERROR: $*"
  if [[ "$PAUSE_ON_EXIT" == "1" ]]; then
    say ""
    read -r -p "Press Enter to close…" _
  fi
  exit 1
}

done_msg() {
  say ""
  say "Done. Remote database matches supabase/migrations/."
  if [[ "$PAUSE_ON_EXIT" == "1" ]]; then
    say ""
    read -r -p "Press Enter to close…" _
  fi
}

say "==> xbx.place — push Supabase to remote"
say "    $(date '+%Y-%m-%d %H:%M:%S')"
say "    repo: $ROOT"
say ""

if ! command -v npx >/dev/null 2>&1; then
  fail "npx not found. Install Node.js from https://nodejs.org/"
fi

say "==> Checking Supabase CLI"
if ! npx supabase --version; then
  fail "Supabase CLI is unavailable. Run: npm install"
fi
say ""

project_ref=""
linked_ref=""
if [[ -f "$ROOT/.supabase/project-ref" ]]; then
  linked_ref="$(tr -d '[:space:]' < "$ROOT/.supabase/project-ref")"
elif [[ -f "$ROOT/supabase/.temp/project-ref" ]]; then
  linked_ref="$(tr -d '[:space:]' < "$ROOT/supabase/.temp/project-ref")"
fi

env_ref=""
if [[ -f "$ROOT/.env.local" ]]; then
  env_url="$(grep -E '^VITE_SUPABASE_URL=' "$ROOT/.env.local" | head -n1 | cut -d= -f2- | tr -d '[:space:]"'"'" || true)"
  if [[ "$env_url" =~ https://([a-z0-9-]+)\.supabase\.co ]]; then
    env_ref="${BASH_REMATCH[1]}"
  fi
fi

project_ref="${linked_ref:-$env_ref}"

if [[ -z "$linked_ref" ]]; then
  say "Supabase CLI is not linked to a remote project in this folder."
  say ""
  say "One-time setup:"
  say "  cd \"$ROOT\""
  say "  npx supabase login"
  if [[ -n "$env_ref" ]]; then
    say "  npx supabase link --project-ref $env_ref"
  else
    say "  npx supabase link --project-ref YOUR_PROJECT_REF"
  fi
  say ""
  fail "Run supabase link first, then try again."
fi

say "==> Linked project: $linked_ref"
if [[ -n "$env_ref" && "$env_ref" != "$linked_ref" ]]; then
  say "    (warning: .env.local points at $env_ref)"
fi
say ""

say "==> Pushing migrations (supabase db push)"
if ! npx supabase db push; then
  fail "supabase db push failed. If you are not logged in, run: npx supabase login"
fi

done_msg
