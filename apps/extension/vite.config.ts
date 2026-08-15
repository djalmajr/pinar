import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    Icons({
      compiler: "jsx",
      jsx: "react",
      autoInstall: true,
    }),
  ],
  resolve: {
    alias: {
      "@pinar/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@pinar/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../../extension/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        options: path.resolve(__dirname, "options.html"),
      },
    },
  },
});
