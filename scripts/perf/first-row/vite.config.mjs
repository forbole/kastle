// Builds the real Activity screen with the REAL feed hooks (useActivityFeed,
// useKcc20SwapHistory, feed-store) and every request hung: only stored rows can
// paint. Data hooks around them come from tests/activity-money/stubs.tsx.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../../..");
const stubs = path.join(here, "stubs.tsx");
const hooks = {
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/evm/useEvmAddress": "useEvmAddress",
  "hooks/useKaspaPrice": "useKaspaPrice",
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "components/BottomNav": "BottomNav",
  "lib/kcc20/useKcc20Tokens": "useKcc20Tokens",
};
const whole = [
  "hooks/useFeatureFlags",
  "hooks/useSettings",
  "hooks/evm/provider/useZealousSwap",
  "lib/kcc20/providers/kascov",
  "lib/kcc20/swap",
  "lib/kcc20/history",
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
      name: "first-row-stubs",
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
      onwarn: (w, warn) => w.code !== "SHIMMED_EXPORT" && warn(w),
    },
  },
});
