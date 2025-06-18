import { defineConfig } from "wxt"; // See https://wxt.dev/api/config.html
import { nodePolyfills } from "vite-plugin-node-polyfills";

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    permissions: ["storage", "alarms", "clipboardRead"],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: ["injected.js"],
        matches: ["*://*/*"],
      },
    ],
    externally_connectable: {
      matches: ["*://*/*"],
    },
    run_at: "document_start",
  },
  runner: {
    startUrls: ["https://forbole.github.io/kastle/"],
  },
  vite: () => ({
    build: {
      minify: false,
      commonjsOptions: {
        transformMixedEsModules: true,
        include: [/hw-app-kaspa/, /bip32-path/, /node_modules/],
      },
      server: {
        fs: {
          strict: false,
        },
      },
    },
    plugins: [
      nodePolyfills({
        protocolImports: true,
        include: ["buffer"],
        globals: {
          Buffer: true,
        },
      }),
    ],
  }),
});
