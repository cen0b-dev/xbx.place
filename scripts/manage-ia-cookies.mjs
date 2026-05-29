#!/usr/bin/env node
/**
 * xbx.place Internet Archive Cookie Pool Manager
 *
 * Usage:  node scripts/manage-ia-cookies.mjs   (or: npm run ia-cookies)
 *
 * Paste browser cookie exports (Chrome/Firefox extension JSON) or legacy
 * { user, sig } JSON. Credentials are stored in Supabase ia_cookie_pool and
 * read at runtime by download-proxy workers and npm run build:ia-map.
 */

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { parseBrowserCookieExport, parseCookieInput, parseIaCookiePoolJson, validateIaCookieSession } from "./ia-cookie-pool.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_LOCAL = join(ROOT, ".env.local");

const C = { bold: "\x1b[1m", dim: "\x1b[2m", reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };
const ok = (m) => console.log(`${C.green}  ✓${C.reset}  ${m}`);
const fail = (m) => console.log(`${C.red}  ✗${C.reset}  ${m}`);
const info = (m) => console.log(`${C.dim}     ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}  !${C.reset}  ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

let rl;
function getRL() {
  if (!rl) rl = createInterface({ input, output });
  return rl;
}
async function ask(prompt) {
  return (await getRL().question(`\n  ${prompt}: `)).trim();
}
async function choose(prompt, options) {
  while (true) {
    console.log(`\n  ${C.bold}${prompt}${C.reset}`);
    options.forEach((o, i) => console.log(`    ${C.dim}${i + 1}.${C.reset} ${o}`));
    const raw = await ask(`Choice (1–${options.length})`);
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= options.length) return n - 1;
    fail("Invalid choice, try again.");
  }
}

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

function supabaseConfig() {
  const env = loadEnvLocal();
  return {
    url: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, ""),
    serviceKey: (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  };
}

async function supabaseRequest(path, method, body) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) return { ok: false, status: 0, error: "missing_config" };

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

async function listCookies() {
  const res = await supabaseRequest(
    "/rest/v1/ia_cookie_pool?select=id,label,user_value,enabled,expires_at,created_at&order=created_at.asc",
    "GET"
  );
  if (!res.ok) {
    if (res.error === "missing_config") {
      fail("Supabase not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    } else {
      fail(`Failed to load pool (${res.status})`);
    }
    return [];
  }
  return Array.isArray(res.data) ? res.data : [];
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return `${C.dim}unknown${C.reset}`;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return `${C.dim}unknown${C.reset}`;
  const iso = d.toISOString().slice(0, 10);
  if (d.getTime() < Date.now()) return `${C.red}expired ${iso}${C.reset}`;
  return iso;
}

function printStatus(rows) {
  if (!rows.length) {
    info("(empty — use 'Add account' to paste a browser cookie export)");
    return;
  }
  rows.forEach((row, i) => {
    const status = row.enabled ? `${C.green}enabled${C.reset}` : `${C.yellow}disabled${C.reset}`;
    const label = row.label || row.user_value || "(unknown)";
    console.log(`  ${C.bold}${i + 1}. ${label}${C.reset}  [${status}]`);
    console.log(`       expires : ${formatExpiry(row.expires_at)}`);
  });
}

async function readMultilineInput() {
  head("Paste cookie JSON");
  info("Export archive.org cookies from a browser extension, paste below,");
  info("then type END on its own line.\n");
  const lines = [];
  while (true) {
    const line = await getRL().question("  ");
    if (line.trim() === "END") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

async function insertCookie(entry, { quiet = false } = {}) {
  const row = {
    user_value: entry.user,
    sig_value: entry.sig,
    label: entry.label ?? "",
    enabled: true,
    ...(entry.expiresAt ? { expires_at: entry.expiresAt } : {}),
  };

  const res = await supabaseRequest("/rest/v1/ia_cookie_pool", "POST", row);
  if (res.ok) {
    if (!quiet) ok(`Added ${entry.label || entry.user}`);
    return true;
  }
  if (res.status === 409) {
    if (!quiet) warn(`Already in pool: ${entry.label || entry.user}`);
    return false;
  }
  if (!quiet) fail(`Insert failed (${res.status})`);
  return false;
}

async function actionAdd() {
  const raw = await readMultilineInput();
  if (!raw) {
    fail("No input provided.");
    return;
  }

  const parsed = parseCookieInput(raw);
  if (parsed) {
    await insertCookie(parsed);
    return;
  }

  const pool = parseIaCookiePoolJson(raw);
  if (pool.length > 1) {
    head(`Importing ${pool.length} accounts from pool JSON...`);
    let added = 0;
    for (const entry of pool) {
      const okInsert = await insertCookie(
        { user: entry.user, sig: entry.sig, label: decodeURIComponent(entry.user), expiresAt: null },
        { quiet: true }
      );
      if (okInsert) added += 1;
    }
    ok(`Added ${added}/${pool.length} account(s).`);
    return;
  }

  fail("Could not parse input. Expected browser cookie export JSON or [{\"user\":\"...\",\"sig\":\"...\"}].");
  if (!parseBrowserCookieExport(raw)) {
    info("Missing logged-in-user and/or logged-in-sig cookies in the export.");
  }
}

async function actionRemove(rows) {
  if (!rows.length) {
    warn("Pool is empty.");
    return;
  }
  const labels = rows.map((r) => r.label || r.user_value || r.id);
  const idx = await choose("Remove which account?", [...labels, "Cancel"]);
  if (idx === labels.length) return;

  const id = rows[idx].id;
  const res = await supabaseRequest(`/rest/v1/ia_cookie_pool?id=eq.${id}`, "DELETE");
  if (res.ok) ok(`Removed "${labels[idx]}".`);
  else fail(`Remove failed (${res.status})`);
}

async function actionToggle(rows) {
  if (!rows.length) {
    warn("Pool is empty.");
    return;
  }
  const labels = rows.map((r) => {
    const name = r.label || r.user_value || r.id;
    const state = r.enabled ? "enabled" : "disabled";
    return `${name}  (${state})`;
  });
  const idx = await choose("Toggle which account?", [...labels, "Cancel"]);
  if (idx === labels.length) return;

  const row = rows[idx];
  const res = await supabaseRequest(
    `/rest/v1/ia_cookie_pool?id=eq.${row.id}`,
    "PATCH",
    { enabled: !row.enabled }
  );
  if (res.ok) ok(`${row.label || row.user_value} is now ${row.enabled ? "disabled" : "enabled"}.`);
  else fail(`Update failed (${res.status})`);
}

async function actionTest(rows) {
  const enabled = rows.filter((r) => r.enabled);
  if (!enabled.length) {
    warn("No enabled accounts to test.");
    return;
  }
  const idx = await choose(
    "Test which account?",
    [...enabled.map((r) => r.label || r.user_value), "Cancel"]
  );
  if (idx === enabled.length) return;

  const row = enabled[idx];
  const res = await supabaseRequest(
    `/rest/v1/ia_cookie_pool?id=eq.${row.id}&select=user_value,sig_value`,
    "GET"
  );
  if (!res.ok || !Array.isArray(res.data) || !res.data[0]) {
    fail("Could not load account.");
    return;
  }

  const { user_value: user, sig_value: sig } = res.data[0];

  process.stdout.write("\n  Testing archive.org session... ");
  try {
    const check = await validateIaCookieSession(user, sig);
    if (check.valid) {
      ok("Session valid (can resolve Archive CDN download).");
    } else {
      fail(check.message ?? "Session invalid.");
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : "Network error");
  }
}

async function main() {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) {
    fail("Supabase not configured.");
    info("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const MENU = [
    "Add account (paste browser cookie JSON)",
    "Remove account",
    "Enable / disable account",
    "Test account session",
    "Refresh list",
    "Exit",
  ];

  while (true) {
    const rows = await listCookies();
    console.log(`\n\n${C.bold}=== xbx.place IA Cookie Pool ===${C.reset}\n`);
    printStatus(rows);

    const idx = await choose("What would you like to do?", MENU);
    if (idx === 0) await actionAdd();
    else if (idx === 1) await actionRemove(rows);
    else if (idx === 2) await actionToggle(rows);
    else if (idx === 3) await actionTest(rows);
    else if (idx === 4) continue;
    else break;
  }

  rl?.close();
  console.log("\nDone.\n");
}

main().catch((err) => {
  rl?.close();
  console.error(err);
  process.exit(1);
});
