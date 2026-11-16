// Builds the real ERC-20 send screen (Erc20Send -> HotWalletConfirm ->
// ConfirmStep -> FailStatus) with its hooks, the details step, the broadcaster
// and Sentry swapped for ./stubs.tsx. viem is real: the spec answers the RPC.
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
  "hooks/evm/useErc20Info": "useErc20Info",
  "hooks/evm/useEvmAddress": "useEvmAddress",
  "hooks/evm/useFeeEstimate": "useFeeEstimate",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useCurrencyValue": "useCurrencyValue",
  "hooks/useAnalytics": "useAnalytics",
  "hooks/ins/useInsRecipientCheck": "useInsRecipientCheck",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/evm/useErc20Prices",
  "hooks/evm/useZealousSwapMetadata",
  "lib/ethereum/transaction",
  "lib/utils",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "erc20-balance-revert-stubs",
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
      ...whole.map((from) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: stubs,
      })),
      // Erc20Send's own relative import of the details step.
      { find: /^\.\/DetailsStep$/, replacement: "stub:DetailsStep" },
      { find: /^@sentry\/react$/, replacement: stubs },
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
