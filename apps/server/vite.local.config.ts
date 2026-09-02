import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import { buildIdentity } from "./build-identity";

const tanstackReactStartServer = fileURLToPath(import.meta.resolve("@tanstack/react-start/server"));
const tanstackReactStartServerEntry = fileURLToPath(new URL("./src/tanstack-server-entry.ts", import.meta.url));
const useSyncExternalStoreShim = fileURLToPath(
  new URL("./src/lib/use-sync-external-store-shim.ts", import.meta.url),
);

export default defineConfig({
  define: {
    "import.meta.env.VITE_PINAR_RUNTIME": JSON.stringify("local"),
    ...buildIdentity(),
  },
  plugins: [
    tailwindcss(),
    Icons({ compiler: "jsx", jsx: "react" }),
    tanstackStart(),
    nitro({ preset: "bun", serveStatic: "inline" }),
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
      {
        find: /^@\/server\/api$/,
        replacement: fileURLToPath(new URL("./src/server/api.local.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      { find: "@pinar/cli", replacement: fileURLToPath(new URL("../cli/src", import.meta.url)) },
    ],
    dedupe: ["react", "react-dom", "@base-ui/react"],
  },
});
