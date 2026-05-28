import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const tasks = [
  { name: "dev", command: "npm", args: ["run", "dev", "--", "--host", "127.0.0.1"] },
  { name: "supabase", command: "npm", args: ["run", "supabase:watch"] }
];

const children = [];
let shuttingDown = false;

function prefix(name, chunk) {
  const lines = chunk.toString().split(/\r?\n/);
  for (const line of lines) {
    if (line) console.log(`[${name}] ${line}`);
  }
}

function startTask(task) {
  const child = spawn(task.command, task.args, {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  child.stdout.on("data", (chunk) => prefix(task.name, chunk));
  child.stderr.on("data", (chunk) => prefix(task.name, chunk));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[${task.name}] exited with ${code ?? "unknown status"}`);
      shutdown(code || 1);
    }
  });

  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

for (const task of tasks) startTask(task);
console.log("[dev-all] running Vite dev server and Supabase migration watcher.");
