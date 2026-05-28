import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const watchTargets = [resolve(root, "supabase")];
const debounceMs = Number(process.env.SUPABASE_WATCH_DEBOUNCE_MS ?? 1200);

let timer = null;
let pushing = false;
let queued = false;

function run(command, args, label) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${label} exited with ${code ?? "unknown status"}`));
    });
    child.on("error", rejectRun);
  });
}

async function pushSupabase() {
  if (pushing) {
    queued = true;
    return;
  }

  pushing = true;
  queued = false;
  console.log("[supabase-watch] pushing local Supabase changes...");
  try {
    await run("npx", ["supabase", "db", "push"], "supabase db push");
    console.log("[supabase-watch] Supabase is up to date.");
  } catch (error) {
    console.error(`[supabase-watch] ${error instanceof Error ? error.message : "Supabase push failed."}`);
  } finally {
    pushing = false;
    if (queued) void pushSupabase();
  }
}

function schedulePush(reason) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[supabase-watch] change detected: ${reason}`);
    void pushSupabase();
  }, debounceMs);
}

for (const target of watchTargets) {
  if (!existsSync(target)) continue;
  try {
    watch(target, { recursive: true }, (_event, filename) => {
      const changed = filename ? String(filename) : target;
      if (changed.includes("migrations") || changed.endsWith("config.toml")) schedulePush(changed);
    });
  } catch {
    watch(target, (_event, filename) => {
      const changed = filename ? String(filename) : target;
      if (changed.includes("migrations") || changed.endsWith("config.toml")) schedulePush(changed);
    });
  }
  console.log(`[supabase-watch] watching ${target}`);
}

if (process.env.SUPABASE_PUSH_ON_START === "1") {
  void pushSupabase();
}

process.stdin.resume();
