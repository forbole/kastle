// Builds the real OptimizeFunds page (real lib/consolidate, real WASM) with
// its wallet, RPC, signer and UTXO hooks swapped for ./stubs.tsx, inside a
// memory router with stub success / failure routes. Mode "real-signer" keeps
// the real useKaspaHotWalletSigner and swaps only its background signer.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import Unimport from "unimport/unplugin";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.tsx");

// Module path -> the stub export that stands in for it (as default and by name).
const hooks = {
  "hooks/useRpcClientStateful": "useRpcClientStateful",
  "hooks/wallet/useWalletManager": "useWalletManager",
  "hooks/wallet/useKaspaHotWalletSigner": "useKaspaHotWalletSigner",
  "hooks/wallet/useKaspaLedgerSigner": "useKaspaLedgerSigner",
  "hooks/useKasFeeEstimate": "useKasFeeEstimate",
  "components/screens/ledger-connect/LedgerConnectForSign":
    "LedgerConnectForSign",
  "components/GeneralHeader": "GeneralHeader",
};
const ext = "(\\.tsx?)?$";

export default defineConfig(({ mode }) => {
  const swapped = Object.entries(hooks).filter(
    ([from]) =>
      mode !== "real-signer" || from !== "hooks/wallet/useKaspaHotWalletSigner",
  );
  return {
    root: here,
    logLevel: "warn",
    plugins: [
      {
        name: "optimize-funds-stubs",
        resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
        load: (id) =>
          id.startsWith("\0stub:")
            ? `export * from ${JSON.stringify(stubs)}; export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};`
            : null,
      },
      Unimport.vite({ presets: ["react"] }),
      react(),
    ],
    resolve: {
      alias: [
        ...swapped.map(([from, name]) => ({
          find: new RegExp(`^@/${from}${ext}`),
          replacement: `stub:${name}`,
        })),
        // imported relatively, and only by the real useKaspaHotWalletSigner
        {
          find: new RegExp(`^\\./useKaspaBackgroundSigner${ext}`),
          replacement: "stub:useKaspaBackgroundSigner",
        },
        { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
      ],
    },
    build: { emptyOutDir: true, minify: false, target: "esnext" },
  };
});
