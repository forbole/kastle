import { defineConfig } from "wxt"; // See https://wxt.dev/api/config.html
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Store builds run in GitHub Actions (publish.yml), where CI is set. Every
// other build is a local/QA build and gets the commit stamped into
// `version_name`, which lib/instrument.ts reads for the Sentry release, so QA
// builds cannot report as the release they were cut from by forgetting a
// manual manifest edit. No new env var: ADR-003 already names CI.
const qaVersionName = () => {
  if (process.env.CI) return undefined;
  try {
    const sha = execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    return `${version}-qa-${sha}`;
  } catch {
    // Not a git tree (a source zip, a reviewer's download). This runs at
    // config load, so throwing would break every wxt command: skip the stamp.
    return undefined;
  }
};
const versionName = qaVersionName();

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    ...(versionName && { version_name: versionName }),
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
    content_scripts: [
      {
        matches: ["*://*/*"],
        js: ["/injector.js"],
        run_at: "document_start",
      },
    ],
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
