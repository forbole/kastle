// Builds the real WalletLockedAlert with its hooks and the WXT `browser`
// global swapped for ./stubs.ts.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/useKeyring": "useKeyring",
  "hooks/useStorageState": "useStorageState",
};
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "wallet-locked-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default, ${id.slice(6)} } from ${JSON.stringify(stubs)};`
          : null,
    },
    // `browser` is a WXT auto-import in the extension build.
    Unimport.vite({
      presets: ["react"],
      imports: [{ name: "browser", from: stubs }],
    }),
    react(),
  ],
  resolve: {
    alias: [
      ...Object.entries(hooks).map(([from, name]) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: `stub:${name}`,
      })),
      { find: new RegExp(`^@/lib/keyring-manager${ext}`), replacement: stubs },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: { emptyOutDir: true, minify: false },
});
