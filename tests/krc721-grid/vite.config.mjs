// Builds the real NftList / KRC721 screen with their context hooks swapped
// for ./stubs.ts. vite, @vitejs/plugin-react and unimport all arrive through
// wxt, which is why the extension's own popup builds at all.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Default-imported hooks: the alias below maps each to `stub:<name>`, which
// this plugin serves as a one-line re-export (vite's alias pass runs before
// any user resolveId, so the `@/` form is never seen here).
const defaults = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/evm/useErc721AssetsFromApi": "useErc721AssetsFromApi",
  "hooks/krc721/useKRC721RecentTransfer": "useKRC721RecentTransfer",
  "hooks/useStorageState": "default",
};

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "krc721-grid-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({
      presets: ["react"],
      imports: [{ name: "useRpcClientStateful", from: stubs }],
    }),
    react(),
  ],
  resolve: {
    alias: [
      ...Object.entries(defaults).map(([from, name]) => ({
        find: new RegExp(`^@/${from}$`),
        replacement: `stub:${name}`,
      })),
      { find: /^@\/lib\/settings\/connection$/, replacement: stubs },
      { find: /^@\/lib\/layer2$/, replacement: stubs },
      {
        find: /^@\/lib\/service\/extension-service(\.ts)?$/,
        replacement: stubs,
      },
      { find: /^@sentry\/react$/, replacement: stubs },
      { find: /^wxt\/storage$/, replacement: stubs },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: { emptyOutDir: true, minify: false },
});
