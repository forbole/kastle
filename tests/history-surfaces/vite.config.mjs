// Builds the four real history surfaces with their data sources swapped for
// ./stubs.tsx, so the spec can render every row shape in real Chrome.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// Repo module (no extension) -> the stub export that stands in as its default.
// Every stub export is also re-exported by name.
const modules = {
  // The four data sources.
  "hooks/useKasTxHistory": "useKasTxHistory",
  "hooks/useOpListByAddressAndTicker": "useOpListByAddressAndTicker",
  "lib/kcc20/useKcc20History": "useKcc20History",
  "hooks/evm/useEvmHistory": "useEvmHistory",
  // What the surfaces read beside them.
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/useCurrencyValue": "useCurrencyValue",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/kasplex/useKrc20Prices": "useKrc20Prices",
  "hooks/kasplex/useTokenInfo": "useTokenInfo",
  "hooks/useFeatureFlags": "useFeatureFlags",
  "hooks/useSettings": "useSettings",
  "hooks/evm/useEvmAddress": "useEvmAddress",
  "hooks/evm/useEvmKasBalance": "useEvmKasBalance",
  "hooks/evm/useErc20Info": "useErc20Info",
  "hooks/evm/useErc20Balance": "useErc20Balance",
  // Erc20Asset imports useErc20Image from this re-export shim; unstubbed, the
  // real hook would fetch token metadata from the harness.
  "hooks/evm/useZealousSwapMetadata": "useErc20Image",
  // Only its explorer link tables; the screen itself is not under test.
  "components/screens/Settings": "explorerTxLinks",
};

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "history-surfaces-stubs",
      enforce: "pre",
      async resolveId(id, importer, options) {
        if (id.startsWith("stub:")) return `\0${id}`;
        if (!importer || importer.startsWith("\0")) return null;
        const resolved = await this.resolve(id, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved) return null;
        const rel = path
          .relative(repo, resolved.id.split("?")[0])
          .replace(/\.(tsx?|jsx?)$/, "");
        return modules[rel] ? `\0stub:${modules[rel]}` : null;
      },
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};
export * from ${JSON.stringify(stubs)};`
          : null,
    },
    Unimport.vite({
      presets: ["react"],
      // WXT auto-imports these; the dashboard list relies on them.
      imports: [
        { name: "default", as: "useSettings", from: "@/hooks/useSettings" },
        {
          name: "default",
          as: "useCurrencyValue",
          from: "@/hooks/useCurrencyValue",
        },
      ],
    }),
    react(),
  ],
  resolve: {
    alias: [
      { find: /^@sentry\/react$/, replacement: stubs },
      { find: /^wxt\/storage$/, replacement: stubs },
      { find: /^wxt\/browser$/, replacement: stubs },
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
