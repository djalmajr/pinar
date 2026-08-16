import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

const tanstackReactStartServer = fileURLToPath(import.meta.resolve("@tanstack/react-start/server"));
const tanstackReactStartServerEntry = fileURLToPath(new URL("./src/tanstack-server-entry.ts", import.meta.url));
const useSyncExternalStoreShim = fileURLToPath(
  new URL("./src/lib/use-sync-external-store-shim.ts", import.meta.url),
);

export default defineConfig({
  define: {
    "import.meta.env.VITE_PINAR_RUNTIME": JSON.stringify("cloud"),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    Icons({
      compiler: "jsx",
      jsx: "react",
    }),
    tanstackStart(),
    react(),
  ],
  resolve: {
    alias: [
      {
        find: /^use-sync-external-store\/shim(?:\/with-selector)?$/,
        replacement: useSyncExternalStoreShim,
      },
      { find: /^@tanstack\/react-start\/server-entry$/, replacement: tanstackReactStartServerEntry },
      { find: /^@tanstack\/react-start\/server$/, replacement: tanstackReactStartServer },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
    dedupe: ["react", "react-dom", "@base-ui/react"],
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
