#!/usr/bin/env node
/**
 * xbx.place Cloudflare Worker Manager
 *
 * Usage:  node scripts/manage-workers.mjs   (or: npm run workers)
 *
 * Manages download-proxy workers across one or more Cloudflare accounts.
 * Accounts are stored in scripts/.cf-accounts.json (gitignored).
 *
 * After every account change the script automatically:
 *   1. Syncs VITE_DOWNLOAD_PROXY_POOL in .env.local
 *   2. Pushes VITE_DOWNLOAD_PROXY_POOL to the GitHub repo variable (via gh CLI)
 *   3. Updates Supabase secrets used by the worker-stats Edge Function
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ACCOUNTS_FILE = join(__dirname, ".cf-accounts.json");
const ENV_LOCAL = join(ROOT, ".env.local");

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

function link(url, text = url) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}
const C = { bold:"\x1b[1m", dim:"\x1b[2m", reset:"\x1b[0m", green:"\x1b[32m", red:"\x1b[31m", cyan:"\x1b[36m", yellow:"\x1b[33m" };
const ok   = (m) => console.log(`${C.green}  ✓${C.reset}  ${m}`);
const fail = (m) => console.log(`${C.red}  ✗${C.reset}  ${m}`);
const info = (m) => console.log(`${C.dim}     ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}  !${C.reset}  ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

let rl;
function getRL() { if (!rl) rl = createInterface({ input, output }); return rl; }
async function ask(prompt) { return (await getRL().question(`\n  ${prompt}: `)).trim(); }
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

// ---------------------------------------------------------------------------
// Config store (scripts/.cf-accounts.json)
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!existsSync(ACCOUNTS_FILE)) return { accounts: [], dashboardPassword: null };
  try {
    const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    return { accounts: raw.accounts ?? [], dashboardPassword: raw.dashboardPassword ?? null };
  } catch { return { accounts: [], dashboardPassword: null }; }
}

function saveConfig(config) {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// .env.local helpers
// ---------------------------------------------------------------------------

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

function setEnvLocalKey(key, value) {
  let content = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "";
  const lines = content.split("\n");
  const idx = lines.findIndex(l => l.trimStart().startsWith(`${key}=`) || l.trimStart().startsWith(`# ${key}=`));
  if (idx >= 0) { lines[idx] = `${key}=${value}`; writeFileSync(ENV_LOCAL, lines.join("\n"), "utf8"); }
  else {
    if (content && !content.endsWith("\n\n")) content = content.replace(/\n*$/, "\n\n");
    writeFileSync(ENV_LOCAL, `${content}${key}=${value}\n`, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Cloudflare API helpers
// ---------------------------------------------------------------------------

async function cfFetch(path, opts, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) }
  });
  return res.json();
}

async function verifyToken(token) {
  const d = await cfFetch("/user/tokens/verify", {}, token);
  return d?.result?.status === "active";
}

async function listCfAccounts(token) {
  const d = await cfFetch("/accounts?per_page=50", {}, token);
  return Array.isArray(d?.result) ? d.result : [];
}

async function getWorkerSubdomain(accountId, token) {
  const d = await cfFetch(`/accounts/${accountId}/workers/subdomain`, {}, token);
  return d?.result?.subdomain ?? null;
}

async function putSecret(accountId, workerName, name, value, token) {
  const d = await cfFetch(
    `/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
    { method: "PUT", body: JSON.stringify({ name, text: value, type: "secret_text" }) },
    token
  );
  if (!d.success) throw new Error(JSON.stringify(d.errors));
}

// ---------------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------------

async function supabaseRequest(path, method, body, env) {
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceKey  = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const res = await fetch(`${supabaseUrl}${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

// ---------------------------------------------------------------------------
// Auto-sync helpers
// ---------------------------------------------------------------------------

/** Sync the worker_pool table in Supabase: replace all rows with current workers. */
async function syncWorkerPoolTable(config) {
  const env = loadEnvLocal();
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  if (!supabaseUrl) { warn("Supabase not configured — worker_pool table not updated."); return; }

  // Delete all existing rows.
  await supabaseRequest("/rest/v1/worker_pool?id=not.is.null", "DELETE", undefined, env);

  // Insert all currently deployed workers.
  const rows = config.accounts
    .filter(a => a.workerUrl)
    .map(a => ({ url: a.workerUrl, worker_name: a.workerName, account_label: a.label, enabled: true }));

  if (!rows.length) { warn("No deployed workers — worker_pool table cleared."); return; }

  const res = await supabaseRequest("/rest/v1/worker_pool", "POST", rows, env);
  if (res && res.ok) {
    ok(`Supabase worker_pool synced → ${rows.length} worker(s)`);
  } else {
    warn(`Supabase worker_pool sync failed (${res?.status ?? "network error"})`);
  }
}

/** Push MANAGED_ACCOUNTS + DASHBOARD_PASSWORD to Supabase Edge Function secrets. */
async function autoSyncSupabase(config) {
  try { execFileSync("npx", ["supabase", "--version"], { cwd: ROOT, stdio: "pipe" }); } catch { return; }

  const managed = config.accounts.map(({ label, accountId, apiToken, workerName, workerUrl }) => ({
    label, accountId, apiToken, workerName, workerUrl,
  }));

  const secretArgs = [`MANAGED_ACCOUNTS=${JSON.stringify(managed)}`];
  if (config.dashboardPassword) secretArgs.push(`DASHBOARD_PASSWORD=${config.dashboardPassword}`);
  const env = loadEnvLocal();
  const discordWebhook = (env.DISCORD_WEBHOOK_URL ?? "").trim();
  if (discordWebhook) secretArgs.push(`DISCORD_WEBHOOK_URL=${discordWebhook}`);

  try {
    execFileSync("npx", ["supabase", "secrets", "set", ...secretArgs], { cwd: ROOT, stdio: "pipe" });
    const extra = [config.dashboardPassword ? "DASHBOARD_PASSWORD" : "", discordWebhook ? "DISCORD_WEBHOOK_URL" : ""].filter(Boolean).join(", ");
    ok(`Supabase secrets updated (MANAGED_ACCOUNTS${extra ? `, ${extra}` : ""})`);
  } catch (err) {
    warn(`Supabase secrets sync failed: ${err.stderr?.toString().trim() ?? err.message}`);
  }
}

async function autoSyncAll(config) {
  await syncWorkerPoolTable(config);
  await autoSyncSupabase(config);
}

// ---------------------------------------------------------------------------
// Wrangler helpers
// ---------------------------------------------------------------------------

function wranglerDeploy(workerDir, workerName, accountId, apiToken) {
  execSync(`npx wrangler deploy --name ${workerName}`, {
    cwd: workerDir, stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId },
  });
}

async function uploadDownloadProxySecrets(accountId, workerName, apiToken) {
  const env = loadEnvLocal();
  const secrets = {
    IA_COOKIE_POOL:            env.IA_COOKIE_POOL ?? "",
    SUPABASE_URL:              env.SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY:         env.SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
  head("Uploading worker secrets...");
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) { info(`SKIP ${name}`); continue; }
    try { await putSecret(accountId, workerName, name, value, apiToken); ok(name); }
    catch (err) { fail(`${name}: ${err.message}`); }
  }
}

// ---------------------------------------------------------------------------
// Action: Add account
// ---------------------------------------------------------------------------

async function actionAddAccount(config) {
  console.log(`
  To add a Cloudflare account you need an API token.

  How to create one:
    1. Open ${link("https://dash.cloudflare.com/profile/api-tokens")}
    2. Click "Create Token" → use the "Edit Cloudflare Workers" template
       (also enable Account Analytics:Read for full dashboard stats)
    3. Paste the token below.
`);

  const apiToken = await ask("API token");
  if (!apiToken) { fail("No token entered."); return; }

  process.stdout.write("\n");
  process.stdout.write("  Verifying token... ");
  if (!(await verifyToken(apiToken))) { fail("Token invalid or inactive."); return; }
  ok("Token verified");

  process.stdout.write("  Fetching accounts... ");
  const cfAccounts = await listCfAccounts(apiToken);
  console.log(`(${cfAccounts.length} found)`);

  let accountId, accountName;
  if (!cfAccounts.length) {
    accountId   = await ask("Account ID (from dashboard URL)");
    accountName = await ask("Label for this account");
  } else if (cfAccounts.length === 1) {
    ({ id: accountId, name: accountName } = cfAccounts[0]);
    ok(`Account: ${accountName} (${accountId})`);
  } else {
    const labels = cfAccounts.map(a => `${a.name}  ${C.dim}(${a.id})${C.reset}`);
    const idx = await choose("Which account?", labels);
    ({ id: accountId, name: accountName } = cfAccounts[idx]);
  }

  if (!accountId) { fail("No account selected."); return; }
  if (config.accounts.find(a => a.accountId === accountId)) {
    warn(`"${accountName}" is already managed.`); return;
  }

  const suffix = randomBytes(3).toString("hex"); // e.g. "a3f9c1"
  const workerName = `xbx-place-download-proxy-${suffix}`;

  config.accounts.push({ label: accountName, accountId, apiToken, workerName, workerUrl: null, addedAt: new Date().toISOString() });
  saveConfig(config);
  ok(`Account saved: "${accountName}" → ${workerName}`);

  await deployToAccount(config, config.accounts.length - 1);
}

// ---------------------------------------------------------------------------
// Action: Deploy download-proxy
// ---------------------------------------------------------------------------

async function deployToAccount(config, idx) {
  const account = config.accounts[idx];
  const { accountId, apiToken, workerName } = account;
  const workerDir = join(ROOT, "workers", "download-proxy");

  head(`Deploying ${workerName} to ${account.label}...`);
  try { wranglerDeploy(workerDir, workerName, accountId, apiToken); }
  catch { fail("wrangler deploy failed."); return; }

  const subdomain = await getWorkerSubdomain(accountId, apiToken);
  if (subdomain) {
    account.workerUrl = `https://${workerName}.${subdomain}.workers.dev`;
    account.subdomain = subdomain;
    ok(`Live at: ${link(account.workerUrl)}`);
  }

  await uploadDownloadProxySecrets(accountId, workerName, apiToken);

  saveConfig(config);
  console.log();
  await autoSyncAll(config);
}

async function actionDeploy(config) {
  if (!config.accounts.length) { warn("No accounts managed yet. Add one first."); return; }
  const labels = config.accounts.map(a =>
    `${a.label}  →  ${a.workerName}${a.workerUrl ? `  ${C.dim}(${a.workerUrl})${C.reset}` : ""}`
  );
  const idx = await choose("Deploy to which account?", [...labels, "Cancel"]);
  if (idx === labels.length) return;
  await deployToAccount(config, idx);
}

// ---------------------------------------------------------------------------
// Action: Deploy / update worker-stats Edge Function
// ---------------------------------------------------------------------------

async function actionDeployEdgeFunction(config) {
  const stored = config.dashboardPassword ?? "";
  const pwInput = await ask(`Dashboard password${stored ? " [keep existing]" : ""}`);
  const password = pwInput || stored;
  if (!password) { fail("Password is required."); return; }

  config.dashboardPassword = password;
  saveConfig(config);

  head("Updating Supabase secrets...");
  await autoSyncSupabase(config);

  head("Deploying worker-stats Edge Function...");
  try {
    execFileSync("npx", ["supabase", "functions", "deploy", "worker-stats"], { cwd: ROOT, stdio: "inherit" });
    ok("Edge Function deployed");
    const env = loadEnvLocal();
    const supaUrl = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
    if (supaUrl) {
      const fnUrl = `${supaUrl}/functions/v1/worker-stats`;
      console.log(`\n  Dashboard backend: ${link(fnUrl)}`);
      console.log(`  Dashboard:         ${link("https://xbx.place/workers")}`);
    }
  } catch {
    fail("Edge Function deploy failed (see output above).");
  }
}

// ---------------------------------------------------------------------------
// Action: Manual sync (Supabase worker_pool table + Edge Function secrets)
// ---------------------------------------------------------------------------

async function actionSyncGitHub(config) {
  head("Re-syncing Supabase worker pool...");
  await syncWorkerPoolTable(config);
  await autoSyncSupabase(config);

  let repo;
  try {
    execFileSync("gh", ["--version"], { stdio: "pipe" });
    const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
    const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    repo = m?.[1];
  } catch { repo = null; }

  if (repo) {
    console.log();
    ok(`Workers are live — GitHub Pages rebuild not needed (pool is read from Supabase at runtime).`);
    info(`Trigger a build at: ${link(`https://github.com/${repo}/actions`)}`);
  }
}

// ---------------------------------------------------------------------------
// Action: Remove account
// ---------------------------------------------------------------------------

async function actionRemove(config) {
  if (!config.accounts.length) { warn("No accounts to remove."); return; }
  const labels = config.accounts.map(a => `${a.label}  →  ${a.workerName}`);
  const idx = await choose("Remove which account?", [...labels, "Cancel"]);
  if (idx === labels.length) return;
  const [removed] = config.accounts.splice(idx, 1);
  saveConfig(config);
  ok(`Removed "${removed.label}".`);
  await autoSyncAll(config);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function printStatus(config) {
  if (!config.accounts.length) { info("(none — use 'Add account' to get started)"); return; }
  config.accounts.forEach((a, i) => {
    const url = a.workerUrl ? link(a.workerUrl) : `${C.dim}not deployed${C.reset}`;
    console.log(`  ${C.bold}${i + 1}. ${a.label}${C.reset}`);
    console.log(`       worker : ${a.workerName}`);
    console.log(`       url    : ${url}`);
  });
  const env = loadEnvLocal();
  const supaUrl = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
  if (supaUrl && config.dashboardPassword) {
    const fnUrl = `${supaUrl}/functions/v1/worker-stats`;
    console.log(`\n  ${C.cyan}Dashboard${C.reset}     : ${link("https://xbx.place/workers")}`);
    console.log(`  ${C.cyan}Stats backend${C.reset} : ${link(fnUrl)}`);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  const config = loadConfig();

  const MENU = [
    "Add new Cloudflare account",
    "Re-deploy worker to account",
    "Update dashboard (Edge Function + password)",
    "Re-sync pool to Supabase",
    "Remove account",
    "Exit",
  ];

  while (true) {
    console.log(`\n\n${C.bold}=== xbx.place Cloudflare Worker Manager ===${C.reset}\n`);
    printStatus(config);
    const idx = await choose("What would you like to do?", MENU);
    if      (idx === 0) await actionAddAccount(config);
    else if (idx === 1) await actionDeploy(config);
    else if (idx === 2) await actionDeployEdgeFunction(config);
    else if (idx === 3) await actionSyncGitHub(config);
    else if (idx === 4) await actionRemove(config);
    else break;
  }

  rl?.close();
  console.log("\nDone.\n");
}

main().catch(err => { rl?.close(); console.error(err); process.exit(1); });
