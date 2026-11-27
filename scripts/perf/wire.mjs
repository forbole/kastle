/* global process, Buffer */
// Re-requests each logged request raw (Accept-Encoding: gzip, br) and counts compressed bytes on the wire.
import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
const raw = (url, method = "GET", body) =>
  new Promise((res) => {
    const u = new URL(url);
    const t0 = performance.now();
    const req = (u.protocol === "http:" ? http : https).request(
      u,
      {
        method,
        headers: {
          "accept-encoding": "gzip, br",
          ...(body ? { "content-type": "application/json" } : {}),
        },
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = r.headers["content-encoding"];
          let dec = buf.length;
          try {
            dec =
              enc === "br"
                ? zlib.brotliDecompressSync(buf).length
                : enc === "gzip"
                  ? zlib.gunzipSync(buf).length
                  : buf.length;
          } catch {
            /* undecodable: count wire bytes as decoded */
          }
          res({
            status: r.statusCode,
            wire: buf.length,
            dec,
            enc: enc ?? "identity",
            ms: Math.round(performance.now() - t0),
            cc: r.headers["cache-control"],
            etag: !!r.headers.etag,
          });
        });
      },
    );
    req.on("error", () => res({ status: "ERR", wire: 0, dec: 0, ms: 0 }));
    if (body) req.write(body);
    req.end();
  });
if (process.argv[2] === "urls") {
  for (const u of process.argv.slice(3)) {
    const r = await raw(u);
    console.log(
      JSON.stringify(r),
      u.replace(/kaspa(:|%3A)[a-z0-9]+/, "kaspa:…").slice(0, 110),
    );
  }
  process.exit(0);
}
const log = JSON.parse(readFileSync(process.argv[2], "utf8"));
const memo = new Map();
// A replay that errors, or answers other than the logged status, has no
// bytes to count: the group is reported INCOMPLETE, never as a smaller total,
// and the failure is not memoised for later groups.
const replayFailed = (r, m) =>
  m.status === "ERR" || (typeof r.status === "number" && m.status !== r.status);
for (const [name, reqs] of Object.entries(log)) {
  let wire = 0,
    dec = 0,
    failed = 0;
  const byHost = {};
  for (const r of reqs) {
    const key = r.method + r.url + (r.body ?? "");
    if (!memo.has(key)) memo.set(key, await raw(r.url, r.method, r.body));
    const m = memo.get(key);
    if (replayFailed(r, m)) {
      memo.delete(key);
      failed++;
      console.log(
        `   replay failed (${m.status}, logged ${r.status}): ${r.url.slice(0, 110)}`,
      );
      continue;
    }
    wire += m.wire;
    dec += m.dec;
    const h = new URL(r.url).host;
    byHost[h] ??= { n: 0, wire: 0, dec: 0 };
    byHost[h].n++;
    byHost[h].wire += m.wire;
    byHost[h].dec += m.dec;
  }
  console.log(
    `${name}: ${reqs.length} requests, wire ${wire} B, decoded ${dec} B` +
      (failed
        ? ` — INCOMPLETE: ${failed} replay(s) failed, totals exclude them`
        : ""),
  );
  for (const [h, v] of Object.entries(byHost))
    console.log(`   ${h}: ${v.n} req, wire ${v.wire}, decoded ${v.dec}`);
}
