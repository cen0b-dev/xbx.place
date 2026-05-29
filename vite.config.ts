import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// ---------------------------------------------------------------------------
// Inject Supabase URL + anon key into public/status/index.html placeholders.
// Both values are publishable — they're already baked into the main JS bundle.
// ---------------------------------------------------------------------------
function injectStatusConfig(supabaseUrl: string, supabaseKey: string): Plugin {
  function transform(html: string) {
    return html
      .replace("%%SUPABASE_URL%%", supabaseUrl)
      .replace("%%SUPABASE_ANON_KEY%%", supabaseKey);
  }

  return {
    name: "inject-status-config",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/status/index.html") return next();
        const file = join(__dirname, "public/status/index.html");
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(transform(readFileSync(file, "utf8")));
      });
    },

    closeBundle() {
      const out = join(__dirname, "dist/status/index.html");
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
    "/status":  "/status/index.html",
    "/status/": "/status/index.html",
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

  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY ?? "";

  return {
    base: "/",
    plugins: [servePublicSubdirIndex(), injectStatusConfig(supabaseUrl, supabaseKey)],
    build: { sourcemap: false },
    server: { port: 5173, strictPort: true },
  };
});
