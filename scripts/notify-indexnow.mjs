import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const KEY_PATH = path.join(ROOT, "public", "indexnow-key.txt");
const BASE = "https://xbx.place";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

async function main() {
  let key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    try {
      key = (await readFile(KEY_PATH, "utf8")).trim();
    } catch {
      key = crypto.randomUUID().replace(/-/g, "");
      await writeFile(KEY_PATH, `${key}\n`, "utf8");
      console.log(`Created ${KEY_PATH} — host this file at ${BASE}/indexnow-key.txt`);
    }
  }

  const sitemap = await readFile(path.join(ROOT, "public", "sitemap.xml"), "utf8");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).slice(0, 10000);
  if (!urls.length) {
    console.log("No URLs found in sitemap; skipping IndexNow ping.");
    return;
  }

  const payload = {
    host: "xbx.place",
    key,
    keyLocation: `${BASE}/indexnow-key.txt`,
    urlList: urls.slice(0, 100),
  };

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  console.log(`IndexNow ping: ${response.status} (${payload.urlList.length} URLs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
