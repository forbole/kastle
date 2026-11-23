// Builds the real dApp send-transaction screen (SendTransaction) with its
// hooks and the extension messaging swapped for ./stubs.tsx. viem and
// lib/ethereum/transaction are real: the spec answers the Kasplex RPC.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/useSettings": "useSettings",
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/useAnalytics": "useAnalytics",
};
// Modules whose named exports all come from the stubs.
const whole = ["api/extension", "api/background/utils"];
const ext = "(\\.tsx?)?$";

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "evm-send-shortfall-stubs",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
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
