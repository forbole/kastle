/* global process */
// Usage: node scripts/perf/rows.mjs <repo> <kaspa> <evm> toActivityItem  (live mainnet swap rows).
// Times the per-render adapter work (rowsForPage + toActivityItem + sort) on real rows. Node V8, not a browser/Hermes.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const [repo, KASPA, EVM, adapter] = process.argv.slice(2);
const { build } = createRequire(repo + "/package.json")("esbuild");
const out = `/tmp/perf-rows-${process.pid}.mjs`;
const stub = {
  name: "stub",
  setup(b) {
    b.onResolve(
      {
        filter:
          /^wxt\/storage$|^@\/lib\/storage$|^react-native$|^expo-|^@react-native|^@sentry/,
      },
      () => ({ path: "s", namespace: "stub" }),
    );
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      loader: "js",
      contents: `export const storage = { getItem: async () => null, setItem: async () => {} }; export const Platform = { OS: "ios", select: o => o.ios ?? o.default }; export const captureException = () => {}; export const captureMessage = () => {}; export const addBreadcrumb = () => {}; export const withScope = () => {}; export default {};`,
    }));
  },
};
await build({
  stdin: {
    contents: [
      "@/lib/activity/swap-history",
      "@/lib/activity/feed",
      "@/lib/activity/mappers",
      "@/lib/activity/adapters",
    ]
      .map((p) => `export * from ${JSON.stringify(p)};`)
      .join("\n"),
    resolveDir: repo,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  tsconfig: repo + "/tsconfig.json",
  jsx: "automatic",
  loader: { ".png": "empty", ".svg": "empty", ".wasm": "empty" },
  plugins: [stub],
  logLevel: "error",
});
const m = await import(pathToFileURL(out).href);
const h = await m.fetchAllSwapHistory(EVM);
const rows = m.assembleActivityFeed(
  h.swaps.map((data) => ({ type: m.SWAP_ACTIVITY_TYPE, data })),
);
const deps = { logoFor: () => undefined, priceFor: () => 0.05 };
const fn = m[adapter];
// Activity.tsx's items: map, then pin in-flight rows (stable sort).
const once = () =>
  m
    .rowsForPage(rows, "swap")
    .map((r) => fn(r, deps))
    .sort((a, b) => Number(b.isInProgress) - Number(a.isInProgress));
for (let i = 0; i < 200; i++) once();
const t = [];
for (let i = 0; i < 200; i++) {
  const a = performance.now();
  once();
  t.push(performance.now() - a);
}
t.sort((a, b) => a - b);
console.log(
  `${adapter}: ${rows.length} rows, per render median ${t[100].toFixed(3)} ms, p95 ${t[190].toFixed(3)} ms (node V8, warmed)`,
);
