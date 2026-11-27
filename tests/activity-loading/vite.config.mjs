// scripts/perf/first-row's build (the real Activity screen and the REAL feed
// hooks), with the feed fetcher and the wallet driven from the page by
// ./stubs.tsx, so a spec can hold, fail or answer the live read and switch
// wallets.
import path from "node:path";
import base from "../../scripts/perf/first-row/vite.config.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const stubs = path.join(here, "stubs.tsx");
const firstRow = path.join(base.root, "stubs.tsx");

export default {
  ...base,
  plugins: [
    {
      name: "activity-loading-stubs",
      enforce: "pre",
      resolveId: (id) => (id.startsWith("stub:") ? `\0${id}` : null),
      load: (id) =>
        id.startsWith("\0stub:")
          ? `export * from ${JSON.stringify(stubs)}; export { ${id.slice(6)} as default } from ${JSON.stringify(stubs)};`
          : null,
    },
    ...base.plugins,
  ],
  resolve: {
    alias: [
      { find: /^@\/lib\/activity\/fetch-feed(\.ts)?$/, replacement: stubs },
      ...base.resolve.alias.map((a) =>
        a.replacement === firstRow ? { ...a, replacement: stubs } : a,
      ),
    ],
  },
};
