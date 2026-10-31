import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const REPO_ROOT = "../..";
const DEV_PORT = 5173;
// The entry chunk holds the shell of antd (layout, menu, locale); pages load separately. Above this it needs a look.
const ENTRY_CHUNK_WARNING_KB = 600;

// `npm run dev`: the UI comes from Vite, /api and /health go to the API process. Production: the API serves dist/.
export default defineConfig(({ mode }) => {
  const apiPort = loadEnv(mode, REPO_ROOT, "").PORT || "3000";
  const api = `http://127.0.0.1:${apiPort}`;
  return {
    plugins: [react()],
    server: { port: DEV_PORT, proxy: { "/api": api, "/health": api } },
    build: {
      chunkSizeWarningLimit: ENTRY_CHUNK_WARNING_KB,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: "react", test: /node_modules\/(react|react-dom|react-router|scheduler)\// }],
          },
        },
      },
    },
  };
});
