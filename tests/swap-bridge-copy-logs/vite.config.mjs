// Builds the real Bridge screen (its catch -> ConfirmButton "Copy logs") with
// its hooks, the WASM, the broadcaster and Sentry swapped for ./stubs.tsx.
// viem is real: the spec answers the EVM RPC.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/wallet/useEvmHotWalletSigner": "useEvmHotWalletSigner",
  "hooks/wallet/useKaspaHotWalletSigner": "useKaspaHotWalletSigner",
  "hooks/wallet/useKaspaBalance": "useKaspaBalance",
  "hooks/evm/useEvmAddress": "useEvmAddress",
  "hooks/evm/useEvmKasBalance": "useEvmKasBalance",
  "hooks/evm/useFeeEstimateByGas": "useFeeEstimateByGas",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useAnalytics": "useAnalytics",
  "hooks/useStorageState": "useStorageState",
  "components/BottomNav": "BottomNav",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/useKasFeeEstimate",
  "hooks/useKcc20Migration",
  "lib/kcc20/migration",
  "lib/bridge/kurve-local-history",
  "lib/wallet/transaction-batch",
  "contexts/SettingsContext",
  "wasm/core/kaspa",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "swap-bridge-copy-logs-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export * from ${JSON.stringify(stubs)}; export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({
      presets: ["react"],
      imports: [
        { name: "browser", from: stubs },
        { name: "useRpcClientStateful", from: stubs },
      ],
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
      {
        find: /^\/node_modules\/(.*)$/,
        replacement: `${repo}/node_modules/$1`,
      },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      shimMissingExports: true,
      onwarn: (warning, warn) => {
        if (warning.code !== "SHIMMED_EXPORT") warn(warning);
      },
    },
  },
});
