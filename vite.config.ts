import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// ---------------------------------------------------------------------------
// Inject Supabase URL + anon key into public/workers/index.html placeholders.
// Both values are publishable — they're already baked into the main JS bundle.
// ---------------------------------------------------------------------------
function injectWorkersConfig(supabaseUrl: string, supabaseKey: string): Plugin {

  function transform(html: string) {
    return html
      .replace("%%SUPABASE_URL%%", supabaseUrl)
      .replace("%%SUPABASE_ANON_KEY%%", supabaseKey);
  }

  return {
    name: "inject-workers-config",

    // Dev: serve the transformed file directly
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/workers/index.html") return next();
        const file = join(__dirname, "public/workers/index.html");
        if (!existsSync(file)) return next();
        _res.setHeader("Content-Type", "text/html; charset=utf-8");
        _res.end(transform(readFileSync(file, "utf8")));
      });
    },

    // Build: patch the copied output file
    closeBundle() {
      const out = join(__dirname, "dist/workers/index.html");
      if (existsSync(out)) {
        writeFileSync(out, transform(readFileSync(out, "utf8")), "utf8");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Serve public/<dir>/index.html for /dir and /dir/ in dev
// ---------------------------------------------------------------------------
function servePublicSubdirIndex(): Plugin {
  const rewrites: Record<string, string> = {
    "/test":     "/test/index.html",
    "/test/":    "/test/index.html",
    "/workers":  "/workers/index.html",
    "/workers/": "/workers/index.html",
  };
  return {
    name: "serve-public-subdir-index",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? "";
        const q = raw.indexOf("?");
        const path = q === -1 ? raw : raw.slice(0, q);
        const search = q === -1 ? "" : raw.slice(q);
        const target = rewrites[path];
        if (target) req.url = `${target}${search}`;
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  process.env.VITE_DOWNLOAD_PROXY_ORIGIN ??=
    env.VITE_DOWNLOAD_PROXY_ORIGIN ||
    "https://xbx-place-download-proxy.contact-cen0b-us.workers.dev";
  // Set VITE_DOWNLOAD_PROXY_POOL (comma-separated origins) to enable
  // multi-account load balancing.  Takes precedence over VITE_DOWNLOAD_PROXY_ORIGIN.

  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY ?? "";

  return {
    base: "/",
    // Rewrite /workers/ → /workers/index.html before injection middleware runs.
    plugins: [servePublicSubdirIndex(), injectWorkersConfig(supabaseUrl, supabaseKey)],
    build: { sourcemap: false },
    server: { port: 5173, strictPort: true },
  };
});
