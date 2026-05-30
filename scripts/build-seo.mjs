import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const steps = [
  "generate-seo-pages.mjs",
  "generate-redirects.mjs",
  "generate-top-games.mjs",
  "generate-landing-pages.mjs",
  "generate-sitemap.mjs",
  "generate-image-sitemap.mjs",
];

for (const script of steps) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const indexNow =
  process.env.INDEXNOW === "1"
    ? spawnSync(process.execPath, [path.join(ROOT, "scripts", "notify-indexnow.mjs")], {
        cwd: ROOT,
        stdio: "inherit",
      })
    : null;
if (indexNow && indexNow.status !== 0) {
  process.exit(indexNow.status ?? 1);
}
