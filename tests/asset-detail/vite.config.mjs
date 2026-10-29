// Builds the real asset detail screens with their data hooks and tab bodies
// swapped for ./stubs.tsx, so the spec can compare their shared chrome.
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
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/wallet/useKaspaBalance": "useKaspaBalance",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/useFeatureFlags": "useFeatureFlags",
  "hooks/useSettings": "useSettings",
  "hooks/kasplex/useTokenInfo": "useTokenInfo",
  "hooks/kasplex/useTokenBalance": "useTokenBalance",
  "hooks/evm/useErc20Info": "useErc20Info",
  "hooks/evm/useErc20Balance": "useErc20Balance",
  "hooks/evm/useEvmKasBalance": "useEvmKasBalance",
  "hooks/dotk/useDotkName": "useDotkName",
  "lib/kcc20/useKcc20Tokens": "useKcc20Tokens",
  "components/screens/Settings": "Tab",
  "components/dashboard/NameCard": "NameCard",
  // Tab bodies are out of scope: one placeholder for all of them.
  "components/kas-asset/KasHistory": "Tab",
  "components/kas-asset/KasInfo": "Tab",
  "components/krc20-asset/TokenHistory": "Tab",
  "components/krc20-asset/TokenInfo": "Tab",
  "components/erc20-asset/Erc20Info": "Tab",
  "components/evm-kas-asset/EvmKasInfo": "Tab",
  "components/evm-kas-asset/EvmKasHistory": "Tab",
  "wasm/core/kaspa": "Tab",
};

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "asset-detail-stubs",
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
    Unimport.vite({ presets: ["react"] }),
    react(),
  ],
  resolve: {
    alias: [
      { find: /^@sentry\/react$/, replacement: stubs },
      { find: /^wxt\/storage$/, replacement: stubs },
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
