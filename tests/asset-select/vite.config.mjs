import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// The send picker's KCC-20 row (tests/asset-select.spec.ts): only the wallet and
// the KRC-20 display fill are stubbed; the row and fillFromKrc20 are real.
const modules = {
  "wasm/core/kaspa": "Tab",
  "hooks/wallet/useWalletManager": "useWalletManager",
  "lib/kcc20/useKcc20Price": "useKrc20FilledToken",
};

export default defineConfig({
  root: here,
  logLevel: "warn",
  plugins: [
    {
      name: "asset-select-stubs",
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
