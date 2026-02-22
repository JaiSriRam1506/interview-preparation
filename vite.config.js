import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPortRaw = String(env.VITE_DEV_PORT || "").trim();
  const devPort = devPortRaw ? Number(devPortRaw) : 5174;
  // Default backend target for local dev.
  // In this workspace the backend is commonly run on 3000 via `.env`/Render-style setups.
  // If your backend uses a different port, set `VITE_BACKEND_URL`.
  const backendTarget = env.VITE_BACKEND_URL || "http://localhost:3000";
  const hmrHost = env.VITE_HMR_HOST || "";

  const configureProxy = (proxy) => {
    // Vite uses node-http-proxy under the hood.
    // ECONNABORTED/ECONNRESET often happen when the browser refreshes or the backend restarts.
    // They are usually harmless but noisy; ignore them.
    proxy.on("error", (err) => {
      const code = String(err?.code || "");
      if (code === "ECONNABORTED" || code === "ECONNRESET") return;
      // Keep other errors visible.

      console.error("proxy error", err);
    });
  };

  const hmr = hmrHost
    ? {
        // When served via https ngrok domain, HMR should use wss on 443.
        host: hmrHost,
        protocol: "wss",
        clientPort: 443,
      }
    : undefined;

  return {
    plugins: [react()],
    server: {
      // Bind to all interfaces (fixes ngrok access on Windows where Vite may bind only to ::1).
      host: true,
      port: Number.isFinite(devPort) && devPort > 0 ? devPort : 5174,
      strictPort: true,
      // Needed for ngrok/mobile access; otherwise Vite blocks unknown Host headers.
      allowedHosts: true,
      hmr,
      proxy: {
        "/api": {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
          configure: configureProxy,
          timeout: 60_000,
          proxyTimeout: 60_000,
        },
        "/socket.io": {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
          configure: configureProxy,
          timeout: 60_000,
          proxyTimeout: 60_000,
        },
      },
    },
  };
});
