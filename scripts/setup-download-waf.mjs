#!/usr/bin/env node
/**
 * Configure Cloudflare WAF rate limiting for download routes on a custom zone.
 *
 * Workers on *.workers.dev are protected by in-worker KV rate limits instead.
 * Run this when download-proxy is routed through a custom domain on your zone.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... node scripts/setup-download-waf.mjs
 *
 * Optional dry run:
 *   node scripts/setup-download-waf.mjs --print-only
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(__dirname, "..", ".env.local");

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return {};
  const out = {};
  for (const line of readFileSync(ENV_LOCAL, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const RULES = [
  {
    description: "xbx download resolve — 20 req / 60s per IP",
    expression: '(http.request.uri.path contains "/download") and not (http.request.uri.path contains "/download/file")',
    requests_per_period: 20,
    period: 60,
  },
  {
    description: "xbx download file — 6 req / 60s per IP",
    expression: 'http.request.uri.path contains "/download/file"',
    requests_per_period: 6,
    period: 60,
  },
];

async function cfFetch(path, token, opts = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  return res.json();
}

function printManualInstructions() {
  console.log("\nCloudflare Dashboard → Security → WAF → Rate limiting rules\n");
  for (const rule of RULES) {
    console.log(`Rule: ${rule.description}`);
    console.log(`  Expression : ${rule.expression}`);
    console.log(`  Threshold  : ${rule.requests_per_period} requests / ${rule.period}s`);
    console.log(`  Action     : Block (429) with Retry-After: ${rule.period}`);
    console.log("");
  }
  console.log("Note: *.workers.dev URLs use in-worker KV limits (see workers/download-proxy/security.mjs).\n");
}

async function ensureRateLimitRules(zoneId, token) {
  const list = await cfFetch(`/zones/${zoneId}/rulesets`, token);
  const entrypoint = list.result?.find((r) => r.phase === "http_ratelimit" && r.kind === "zone");
  if (!entrypoint?.id) {
    throw new Error("Could not find http_ratelimit zone ruleset entry point.");
  }

  const current = await cfFetch(`/zones/${zoneId}/rulesets/${entrypoint.id}`, token);
  const existing = Array.isArray(current.result?.rules) ? current.result.rules : [];

  const rules = [...existing];
  for (const spec of RULES) {
    const already = rules.some((r) => r.description === spec.description);
    if (already) {
      console.log(`  skip (exists): ${spec.description}`);
      continue;
    }
    rules.push({
      action: "block",
      description: spec.description,
      enabled: true,
      expression: spec.expression,
      ratelimit: {
        characteristics: ["ip.src"],
        period: spec.period,
        requests_per_period: spec.requests_per_period,
        mitigation_timeout: spec.period,
      },
    });
    console.log(`  add: ${spec.description}`);
  }

  const update = await cfFetch(`/zones/${zoneId}/rulesets/${entrypoint.id}`, token, {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
  if (!update.success) {
    throw new Error(JSON.stringify(update.errors));
  }
}

async function main() {
  const printOnly = process.argv.includes("--print-only");
  const env = { ...loadEnvLocal(), ...process.env };
  const token = (env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const zoneId = (env.CLOUDFLARE_ZONE_ID ?? "").trim();

  printManualInstructions();
  if (printOnly) return;

  if (!token || !zoneId) {
    console.log("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID to apply rules via API.\n");
    return;
  }

  console.log(`Applying rate limit rules to zone ${zoneId}...`);
  await ensureRateLimitRules(zoneId, token);
  console.log("Done.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
