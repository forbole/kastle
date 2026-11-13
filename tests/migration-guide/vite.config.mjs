// Builds the real MigrationGuide route (and the real MigrationGuidePage,
// PageHeader, Button and migrationRowUrl) with its hooks swapped for
// ./stubs.ts, inside a memory router with stub neighbour routes.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/useAnalytics": "useAnalytics",
  "hooks/useKcc20Migration": "useKcc20Migration",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/wallet/useWalletManager": "useWalletManager",
};
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "migration-guide-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default, ${id.slice(6)} } from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({ presets: ["react"] }),
    react(),
  ],
  resolve: {
    alias: [
      ...Object.entries(hooks).map(([from, name]) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: `stub:${name}`,
      })),
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: { emptyOutDir: true, minify: false },
});
