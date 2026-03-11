import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: path.resolve(__dirname, ".."),
  envPrefix: ["VITE_", "PAYABLE_"],
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "..", "dist", "frontend", "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) return undefined;

          if (normalized.includes("/firebase/")) return "vendor-firebase";

          return "vendor";
        },
      },
    },
  },
});
