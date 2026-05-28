#!/usr/bin/env bash
# Double-click in Finder to push supabase/migrations to your linked Supabase project.
export PAUSE_ON_EXIT=1
exec "$(dirname "$0")/scripts/supabase-push.sh"
