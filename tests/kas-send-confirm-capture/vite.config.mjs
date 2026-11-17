// Builds the real KAS send ConfirmStep (and the real planTransfer) with its
// hooks, the batch signer, Sentry and the WASM swapped for ./stubs.ts.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/wallet/useKaspaBalance": "useKaspaBalance",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/useRecentAddresses": "useRecentAddresses",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useCurrencyValue": "useCurrencyValue",
  "hooks/useAnalytics": "useAnalytics",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/useKasFeeEstimate",
  "lib/wallet/transaction-batch",
  "wasm/core/kaspa",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "kas-send-confirm-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default, ${id.slice(6)} } from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({
      presets: ["react"],
      imports: ["useRpcClientStateful", "useAnalytics"].map((name) => ({
        name,
        from: stubs,
      })),
    }),
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
      { find: /^@sentry\/react$/, replacement: stubs },
      { find: /^wxt\/storage$/, replacement: stubs },
      { find: /^wxt\/browser$/, replacement: stubs },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    // lib/kaspa imports more of the WASM than the confirm step calls.
    rollupOptions: {
      shimMissingExports: true,
      onwarn: (warning, warn) => {
        if (warning.code !== "SHIMMED_EXPORT") warn(warning);
      },
    },
  },
});
