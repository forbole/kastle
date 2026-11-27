/* global process */
// Replays the extension Activity fetch graph — lib/activity/fetch-feed.ts (the feed hook's
// fetcher) and hooks/useKcc20SwapHistory.ts:64,122,135 — with the repo's real fetchers,
// bundled to /tmp by esbuild, fetch instrumented. Writes nothing to the repo.
// Usage: node scripts/perf/measure.mjs <repo> <kaspa> <evm> "" <log.json>; then wire.mjs <log.json>.
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";
const repo = process.argv[2],
  KASPA = process.argv[3],
  EVM = process.argv[4];
const require = createRequire(repo + "/package.json");
const { build } = require("esbuild");
const out = `/tmp/perf-bundle-${process.pid}.mjs`;
const stub = {
  name: "stub",
  setup(b) {
    b.onResolve({ filter: /^wxt\/storage$/ }, () => ({
      path: "s",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      loader: "js",
      contents: `const store = new Map(); export const storage = { getItem: async k => store.get(k) ?? null, setItem: async (k,v) => void store.set(k,v), removeItem: async k => void store.delete(k), watch: () => () => {} };`,
    }));
  },
};
await build({
  stdin: {
    contents: [
      "@/lib/activity/fetch-feed",
      "@/lib/activity/feed-store",
      "@/lib/activity/kcc20-swap-history",
    ]
      .map((p) => `export * from ${JSON.stringify(p)};`)
      .concat([
        `export { ownerStrings, standardOwnerKey } from "@/lib/kcc20/history";`,
      ])
      .join("\n"),
    resolveDir: repo,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  tsconfig: repo + "/tsconfig.json",
  loader: { ".png": "empty", ".svg": "empty", ".wasm": "empty" },
  plugins: [stub],
  logLevel: "error",
});

const als = new AsyncLocalStorage();
const log = [];
const T = () => performance.now();
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const rec = {
    src: als.getStore() ?? "?",
    url: String(url),
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : undefined,
    t0: T(),
  };
  log.push(rec);
  try {
    const res = await real(url, init);
    const buf = await res.clone().arrayBuffer();
    rec.status = res.status;
    rec.bytes = buf.byteLength;
    rec.t1 = T();
    return res;
  } catch (e) {
    rec.status = "ERR";
    rec.bytes = 0;
    rec.t1 = T();
    throw e;
  }
};
const m = await import(pathToFileURL(out).href);
const tag = (src, fn) =>
  als.run(src, async () => {
    const t0 = T();
    const v = await fn();
    return { v, ms: T() - t0 };
  });

async function feed(force) {
  const start = log.length,
    t0 = T();
  const r = await tag("feed", () =>
    m.fetchActivityFeed({ sender: EVM, kaspaAddress: KASPA, forceIgra: force }),
  );
  return { ms: T() - t0, reqs: log.slice(start), v: r.v };
}
async function kcc20() {
  const start = log.length,
    t0 = T();
  const CS = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"; // bech32 → x-only key (standardOwnerKey needs the wasm)
  const five = [...KASPA.split(":")[1]].map((c) => CS.indexOf(c)).slice(0, -8);
  let acc = 0,
    bits = 0;
  const bytes = [];
  for (const v of five) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  const owners = m.ownerStrings(Uint8Array.from(bytes.slice(1, 33)));
  const a = await tag("kcc20-transfers", () =>
    m.fetchKcc20SwapTransfers(KASPA, owners.slice(0, 2)),
  );
  const rowsMs = T() - t0;
  let built = { swaps: [], braidSells: [] };
  if (a.v.tip)
    built = m.buildKcc20SwapRecords({
      rows: a.v.rows,
      own: new Set(owners),
      tip: a.v.tip,
      tokens: m.kcc20SwapTokenMeta([], a.v.holdings),
    });
  const braidIds = m.braidCandidateTxids(built.swaps, built.braidSells);
  const [money, braid] = await Promise.all([
    tag("kcc20-money", () => m.fetchKcc20SwapMoney(KASPA, built.swaps)),
    tag("kcc20-braid", () => m.fetchBraidTxids(KASPA, braidIds)),
  ]);
  // The settled family as hooks/useKcc20SwapHistory.ts assembles it (no local pending Braid swaps).
  const { braidSells, ...rest } = built;
  const family = {
    ...rest,
    health: a.v.health,
    swaps: m.applyBraidTxids(
      m.applyKcc20SwapMoney(rest.swaps, money.v),
      braidSells,
      braid.v.braid,
      [],
    ),
    braidUnread: braid.v.unread,
  };
  return {
    family,
    ms: T() - t0,
    rowsMs,
    reqs: log.slice(start),
    transfers: a.v.rows.length,
    swaps: built.swaps.length,
    moneyIds: m.kcc20SwapMoneyTxids(built.swaps).length,
    braidIds: braidIds.length,
    health: a.v.health,
  };
}
const host = (u) => {
  const x = new URL(u);
  const q = x.searchParams;
  return (
    (q.get("action") ? `[${q.get("action")} p${q.get("page")}] ` : "") +
    x.host +
    x.pathname
      .replace(/(kaspa(:|%3A)[a-z0-9]+|0x[0-9a-fA-F]{40}|[0-9a-f]{64})/g, "…")
      .slice(0, 60)
  );
};
function report(name, run) {
  const by = {};
  for (const r of run.reqs) {
    const k = `${r.src} | ${r.method} ${host(r.url)}`;
    by[k] ??= { n: 0, b: 0, ms: [] };
    by[k].n++;
    by[k].b += r.bytes;
    by[k].ms.push(Math.round(r.t1 - r.t0));
  }
  const tot = run.reqs.reduce((s, r) => s + r.bytes, 0);
  console.log(
    `\n## ${name}: wall ${Math.round(run.ms)} ms, ${run.reqs.length} requests, ${tot} bytes decoded`,
  );
  if (run.per)
    for (const [k, v] of Object.entries(run.per))
      console.log(`   source ${k}: ${Math.round(v.ms)} ms`);
  for (const [k, v] of Object.entries(by))
    console.log(
      `   ${String(v.n).padStart(3)}× ${String(v.b).padStart(8)} B  [${v.ms.join(",")}] ms  ${k}`,
    );
}
const ONLY = process.argv[5];
if (ONLY === "kcc20") {
  const k = await kcc20();
  report("kcc20 COLD", k);
  console.log(
    "   ",
    JSON.stringify({
      rowsMs: Math.round(k.rowsMs),
      transfers: k.transfers,
      swaps: k.swaps,
      moneyIds: k.moneyIds,
      braidIds: k.braidIds,
      health: k.health,
    }),
  );
  const k2 = await kcc20();
  report("kcc20 POLL (money/braid caches hot)", k2);
  process.exit(0);
}
const a = await feed(false);
report("feed COLD (fresh process, empty caches+storage)", a);
console.log(
  "   rows:",
  "swaps",
  a.v.swapHistory.swaps.length,
  "bridge items",
  a.v.items.length,
  "degraded",
  JSON.stringify([
    a.v.swapHistory.degraded,
    a.v.bridgeSource,
    a.v.depositSource,
    a.v.kurveSource,
  ]),
);
const k = await kcc20();
report("kcc20 COLD", k);
console.log(
  "   ",
  JSON.stringify({
    rowsMs: Math.round(k.rowsMs),
    transfers: k.transfers,
    swaps: k.swaps,
    moneyIds: k.moneyIds,
    braidIds: k.braidIds,
    health: k.health,
  }),
);
const b = await feed(false);
report("feed POLL (same process, module caches hot, igra head TTL live)", b);
const c = await feed(true);
report("feed POLL with igra head re-read (force=true ≙ head TTL expired)", c);
const k2 = await kcc20();
report("kcc20 POLL (money/braid caches hot)", k2);

import { writeFileSync } from "node:fs";
// What the hooks store after this cold read: seeds scripts/perf/first-row.
writeFileSync(
  (process.argv[6] ?? "/tmp/ap/log.json") + ".stored.json",
  JSON.stringify({
    feed: m.encodeStored(a.v),
    kcc20: m.encodeStored(k.family),
  }),
);
writeFileSync(
  process.argv[6] ?? "/tmp/ap/log.json",
  JSON.stringify({
    cold: [...a.reqs, ...k.reqs],
    poll: [...b.reqs, ...k2.reqs],
    pollHead: [...c.reqs, ...k2.reqs],
  }),
);
