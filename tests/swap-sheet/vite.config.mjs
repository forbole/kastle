// Builds the real swap token sheet, family tabs and provider rows with real
// styles, so a spec can measure and photograph them (tests/parity-qa.spec.ts).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "../..");
const stubs = path.join(here, "stubs.ts");

export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/hooks\/useStorageState$/, replacement: stubs },
      { find: /^@\/contexts\/SettingsContext$/, replacement: stubs },
      { find: /^wxt\/browser$/, replacement: stubs },
      {
        find: /^\/node_modules\/(.*)$/,
        replacement: `${repo}/node_modules/$1`,
      },
      { find: /^@\/(.*)$/, replacement: `${repo}/$1` },
    ],
  },
  build: { emptyOutDir: true, minify: false },
});
