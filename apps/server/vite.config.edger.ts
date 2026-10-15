import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import { buildIdentity } from "./build-identity";

const tanstackReactStartServer = fileURLToPath(import.meta.resolve("@tanstack/react-start/server"));
const tanstackReactStartServerEntry = fileURLToPath(new URL("./src/edger-server-entry.ts", import.meta.url));
const useSyncExternalStoreShim = fileURLToPath(
  new URL("./src/lib/use-sync-external-store-shim.ts", import.meta.url),
);
const edgerApi = fileURLToPath(new URL("./src/server/api.edger.ts", import.meta.url));

// HTTP/Hrana client: the package root statically imports the native `libsql`
// addon, which Deno on EdgeR cannot load. Remote `http:`/`https:`/`libsql:`
// URLs are the EdgeR database, so the bare specifier resolves straight to the
// remote client build.
const libsqlHttp = fileURLToPath(
  new URL("./node_modules/@libsql/client/lib-esm/http.js", import.meta.url),
);

// The `@libsql/isomorphic-ws` shim picks its Node variant (`ws`) under
// Vite's SSR resolve conditions, which Deno cannot bundle; the web variant
// uses the global WebSocket that Deno provides. It is a transitive
// dependency (`@libsql/hrana-client`), so Bun links it only inside its
// content store: prefer a normal link, fall back to the store path.
function isomorphicWsWeb(): string {
  const candidates = [
    fileURLToPath(new URL("./node_modules/@libsql/isomorphic-ws/web.mjs", import.meta.url)),
    fileURLToPath(
      new URL(
        "../../node_modules/.bun/@libsql+isomorphic-ws@0.1.5/node_modules/@libsql/isomorphic-ws/web.mjs",
        import.meta.url,
      ),
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `@libsql/isomorphic-ws web.mjs not found; tried: ${candidates.join(" | ")}`,
  );
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_PINAR_RUNTIME": JSON.stringify("cloud"),
    ...buildIdentity(),
  },
  plugins: [
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
      {
        find: /^@tanstack\/react-start\/server-entry$/,
        replacement: tanstackReactStartServerEntry,
      },
      { find: /^@tanstack\/react-start\/server$/, replacement: tanstackReactStartServer },
      // The EdgeR build swaps the Cloudflare-bindings API for the
      // environment-variable API (same pattern as vite.local.config.ts).
      { find: /^@\/server\/api$/, replacement: edgerApi },
      { find: /^@libsql\/client$/, replacement: libsqlHttp },
      { find: /^@libsql\/isomorphic-ws$/, replacement: isomorphicWsWeb() },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
    dedupe: ["react", "react-dom", "@base-ui/react"],
  },
  // Everything is embedded in the bundle: the EdgeR runtime does not install
  // dependencies next to the artifact.
  ssr: {
    noExternal: true,
  },
  build: {
    outDir: "dist/edger",
    emptyOutDir: true,
    // Deno's module graph reads JSDoc `import("../types")` type references
    // in plain JS as dependencies and rejects the bundle because the files
    // do not exist; minifying the server chunks drops the comments.
    minify: true,
  },
});
