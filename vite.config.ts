import { defineConfig } from "vite";

process.env.VITE_DOWNLOAD_PROXY_ORIGIN ??=
  "https://xbx-place-download-proxy.contact-cen0b-us.workers.dev";

export default defineConfig({
  base: "/",
  build: {
    sourcemap: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
