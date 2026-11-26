// Builds the real Activity screen (list rows + detail sheet) with its data
// hooks swapped for ./stubs.tsx. The adapters, mappers, price resolution and
// formatters are the real modules: what the spec reads is what the popup shows.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// Module path -> stub export stands in for it (as default, by name).
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "components/BottomNav": "BottomNav",
  "lib/kcc20/useKcc20Tokens": "useKcc20Tokens",
};
// Modules whose named exports all come from the stubs.
const whole = [
  "hooks/useActivityFeed",
  "hooks/useFeatureFlags",
  "hooks/useSettings",
  "hooks/evm/provider/useZealousSwap",
  "lib/kcc20/providers/kascov",
  "lib/kcc20/swap",
  "contexts/SettingsContext",
  "components/screens/Settings",
  "wasm/core/kaspa",
];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "activity-money-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export * from ${JSON.stringify(stubs)}; export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};`
          : null,
    },
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
      ...whole.map((from) => ({
        find: new RegExp(`^@/${from}${ext}`),
        replacement: stubs,
      })),
      { find: /^wxt\/storage$/, replacement: stubs },
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
