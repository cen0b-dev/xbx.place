import { defineConfig } from "vite";

export default defineConfig({
  base: "/xbx.place/",
  build: {
    sourcemap: false
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/download": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  }
});
