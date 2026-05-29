#!/usr/bin/env node
/**
 * Store DISCORD_WEBHOOK_URL in Supabase Edge Function secrets (not .env.local).
 *
 * Usage (paste URL once — not saved in repo):
 *   DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...' npm run supabase:discord-webhook
 *
 * Or:
 *   npm run supabase:discord-webhook -- 'https://discord.com/api/webhooks/...'
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function projectRef() {
  for (const rel of [".supabase/project-ref", "supabase/.temp/project-ref"]) {
    const path = join(ROOT, rel);
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
  }
  return "";
}

const url = (process.argv[2] ?? process.env.DISCORD_WEBHOOK_URL ?? "").trim();
if (!url) {
  console.error("Missing webhook URL.");
  console.error("  DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...' npm run supabase:discord-webhook");
  process.exit(1);
}

if (!/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/i.test(url)) {
  console.error("URL must look like https://discord.com/api/webhooks/<id>/<token>");
  process.exit(1);
}

const ref = projectRef();
if (!ref) {
  console.error("No linked Supabase project. Run: npx supabase link --project-ref YOUR_REF");
  process.exit(1);
}

try {
  execFileSync(
    "npx",
    ["supabase", "secrets", "set", `DISCORD_WEBHOOK_URL=${url}`, "--project-ref", ref],
    { cwd: ROOT, stdio: "inherit" }
  );
  console.log("DISCORD_WEBHOOK_URL stored in Supabase secrets (log-event, report-game, report-comment).");
  console.log("Redeploy edge functions if needed: npx supabase functions deploy log-event report-game report-comment");
} catch (err) {
  console.error(err.message ?? err);
  process.exit(1);
}
