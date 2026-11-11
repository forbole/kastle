// Builds the real dApp sign confirm screen (SignConfirm) with the real WASM;
// wallet, settings and the KCC-20 pieces fetch come from ./stubs.ts.
// SIGN_HARNESS_REPO points `@/` at another checkout, so one harness renders two trees.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import process from "node:process";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = process.env.SIGN_HARNESS_REPO ?? path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Module path -> stub export stands in for it (as default by name).
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useCurrencyValue": "useCurrencyValue",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/useSettings",
  "hooks/useFeatureFlags",
  "lib/service/extension-service",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "sign-confirm-stubs",
      enforce: "pre",
      resolveId: (id) =>
        id.startsWith("stub:")
          ? `\0${id}`
          : // The decode hook imports the fetcher by relative path, past the aliases.
            /(^|\/)wallet-pieces(\.ts)?$/.test(id)
            ? stubs
            : null,
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default, ${id.slice(6)} } from ${JSON.stringify(stubs)};`
          : null,
    },
    react(),
  ],
  resolve: {
    alias: [
      ...Object.entries(hooks).map(([from, name]) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: `stub:${name}`,
      })),
      ...whole.map((from) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: stubs,
      })),
      { find: /^wxt\/storage$/, replacement: stubs },
      { find: /^wxt\/browser$/, replacement: stubs },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    target: "esnext",
  },
});
