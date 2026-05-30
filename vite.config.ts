import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// ---------------------------------------------------------------------------
// Inject Supabase URL + anon key into public/status/index.html placeholders.
// Both values are publishable — they're already baked into the main JS bundle.
// ---------------------------------------------------------------------------
function injectSiteMeta(html: string, env: Record<string, string>): string {
  const googleToken = env.VITE_GOOGLE_SITE_VERIFICATION?.trim() ?? "";
  const googleMeta = googleToken
    ? `<meta name="google-site-verification" content="${googleToken}" />`
    : "";
  return html.replace("<!-- %%GOOGLE_SITE_VERIFICATION%% -->", googleMeta);
}

function injectPublicConfig(supabaseUrl: string, supabaseKey: string, env: Record<string, string>): Plugin {
  function transform(html: string) {
    return injectSiteMeta(
      html
        .replace("%%SUPABASE_URL%%", supabaseUrl)
        .replace("%%SUPABASE_ANON_KEY%%", supabaseKey),
      env
    );
  }

  const injectedPages = ["public/status/index.html", "public/test/index.html"];

  return {
    name: "inject-public-config",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        const rel = injectedPages.find((p) => url === `/${p.replace("public/", "")}`);
        if (!rel) return next();
        const file = join(__dirname, rel);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(transform(readFileSync(file, "utf8")));
      });
    },

    closeBundle() {
      for (const rel of injectedPages) {
        const out = join(__dirname, "dist", rel.replace("public/", ""));
        if (existsSync(out)) {
          writeFileSync(out, transform(readFileSync(out, "utf8")), "utf8");
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Serve public/<dir>/index.html for /dir and /dir/ in dev
// ---------------------------------------------------------------------------
function servePublicSubdirIndex(): Plugin {
  const rewrites: Record<string, string> = {
    "/status":   "/status/index.html",
    "/status/":  "/status/index.html",
    "/workers":  "/workers/index.html",
    "/workers/": "/workers/index.html",
    "/test":     "/test/index.html",
    "/test/":    "/test/index.html",
    "/guides":   "/guides/index.html",
    "/guides/":  "/guides/index.html",
  };

  function rewriteGenreOrGame(pathname: string): string | null {
    const genreMatch = /^\/genre\/([^/]+)\/?$/.exec(pathname);
    if (genreMatch) return `/genre/${genreMatch[1]}/index.html`;
    const gameMatch = /^\/game\/([^/]+)\/?$/.exec(pathname);
    if (gameMatch) return `/game/${gameMatch[1]}/index.html`;
    return null;
  }

  return {
    name: "serve-public-subdir-index",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? "";
        const q = raw.indexOf("?");
        const pathOnly = q === -1 ? raw : raw.slice(0, q);
        const search = q === -1 ? "" : raw.slice(q);
        const target = rewrites[pathOnly] ?? rewriteGenreOrGame(pathOnly);
        if (target) req.url = `${target}${search}`;
        next();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Replace font-display:block (FontAwesome default) with font-display:swap in
// the bundled CSS so icon fonts never block text rendering.
// ---------------------------------------------------------------------------
function swapFontDisplay(): Plugin {
  return {
    name: "swap-font-display",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "asset" && chunk.fileName.endsWith(".css")) {
          const src = chunk.source;
          if (typeof src === "string") {
            chunk.source = src.replace(/font-display:block/g, "font-display:swap");
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Generate genre/game SEO pages + sitemap into public/ before the dist copy.
// Skipped when npm run build already ran build:data (VITE_SEO_BUILT=1).
// ---------------------------------------------------------------------------
function generateSeoArtifacts(): Plugin {
  return {
    name: "generate-seo-artifacts",
    buildStart() {
      if (process.env.VITE_SEO_BUILT === "1") return;
      const script = join(__dirname, "scripts", "build-seo.mjs");
      const result = spawnSync(process.execPath, [script], {
        cwd: __dirname,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        throw new Error("SEO artifact generation failed");
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY ?? "";

  return {
    base: "/",
    plugins: [
      servePublicSubdirIndex(),
      injectPublicConfig(supabaseUrl, supabaseKey, env),
      swapFontDisplay(),
      ...(command === "build" ? [generateSeoArtifacts()] : []),
    ],
    build: { sourcemap: false },
    server: { port: 5173, strictPort: true },
    transformIndexHtml(html: string) {
      return injectSiteMeta(html, env);
    },
  };
});
