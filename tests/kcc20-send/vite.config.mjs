// Builds the real KCC-20 / KRC-20 send screens with their hooks, the KCC-20
// builder and the WASM swapped for ./stubs.ts. KCC20_HARNESS_REPO points the
// `@/` alias at another checkout, so one harness renders two trees.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";
import process from "node:process";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = process.env.KCC20_HARNESS_REPO ?? path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/wallet/useKaspaHotWalletSigner": "useKaspaHotWalletSigner",
  "hooks/wallet/useKaspaBalance": "useKaspaBalance",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/useRecentAddresses": "useRecentAddresses",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useCurrencyValue": "useCurrencyValue",
  "hooks/useMempoolStatus": "useMempoolStatus",
  "hooks/usePriorityFeeEstimate": "usePriorityFeeEstimate",
  "hooks/useAnalytics": "useAnalytics",
  "hooks/kasplex/useKrc20Logo": "useKrc20Logo",
  "lib/kcc20/useKcc20Tokens": "useKcc20Tokens",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/useSettings",
  "hooks/useKasFeeEstimate",
  "hooks/useFeatureFlags",
  "hooks/names/useResolveRecipient",
  "hooks/kasplex/useTokenInfo",
  "hooks/kasplex/useKrc20Prices",
  "hooks/kasplex/useTokenBalance",
  "hooks/kns/useKns",
  "lib/kcc20",
  "lib/kcc20/transfer",
  "lib/kcc20/standard/build-transfer",
  "lib/service/extension-service",
  "components/screens/Settings",
  "wasm/core/kaspa",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "kcc20-send-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default, ${id.slice(6)} } from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({
      presets: ["react"],
      imports: ["useRpcClientStateful", "useSettings", "useAnalytics"].map(
        (name) => ({ name, from: stubs }),
      ),
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
      // DetailsStep pulls the currency flags by absolute path.
      {
        find: /^\/node_modules\/(.*)$/,
        replacement: `${repo}/node_modules/$1`,
      },
      { find: /^@sentry\/react$/, replacement: stubs },
      { find: /^wxt\/storage$/, replacement: stubs },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    // lib/krc20 and lib/kaspa import more of the WASM than the screens call.
    rollupOptions: {
      shimMissingExports: true,
      onwarn: (warning, warn) => {
        if (warning.code !== "SHIMMED_EXPORT") warn(warning);
      },
    },
  },
});
