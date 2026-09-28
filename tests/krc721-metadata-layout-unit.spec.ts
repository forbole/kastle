import { expect, test } from "@playwright/test";
import { fakeBrowser } from "@webext-core/fake-browser";

// KSPR keeps its metadata at `{buri}/{id}.json`; the old fetcher only tried
// `{buri}/{id}` and threw on the 404, so the collection never rendered. The
// fallback must fire on 404 only, be remembered per buri, and be shared by
// every card of the same page — a page of 50 must not pay 50 probes.

const BURI = "ipfs://bafyTest";
const GW = "https://gateway.pinata.cloud/ipfs/bafyTest";

type Fetch = typeof globalThis.fetch;
let calls: string[];
let fetchIPFSMetadata: <T>(buri: string, id: string) => Promise<T>;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as Fetch;
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const status = (s: number) => new Response("", { status: s });

// One worker runs other spec files after this one; they get the real fetch.
const realFetch = globalThis.fetch;
test.afterAll(() => {
  globalThis.fetch = realFetch;
});

test.beforeAll(async () => {
  // wxt/storage captures `browser` at import time, so the fake goes first.
  (globalThis as { chrome?: unknown }).chrome = fakeBrowser;
  ({ fetchIPFSMetadata } = await import("@/lib/cache/ipfsCache"));
});

test.beforeEach(() => {
  calls = [];
  fakeBrowser.reset();
});

test("falls back to .json on 404 and remembers the layout", async () => {
  stubFetch((url) =>
    url.endsWith(".json") ? json({ name: `n${url}` }) : status(404),
  );
  const first = await fetchIPFSMetadata<{ name: string }>(BURI, "1");
  expect(first.name).toBe(`n${GW}/1.json`);
  expect(calls).toEqual([`${GW}/1`, `${GW}/1.json`]);

  calls = [];
  const second = await fetchIPFSMetadata<{ name: string }>(BURI, "2");
  expect(second.name).toBe(`n${GW}/2.json`);
  // Layout memoised: no bare probe for the second token.
  expect(calls).toEqual([`${GW}/2.json`]);
});

test("does not retry on a non-404 failure", async () => {
  stubFetch(() => status(503));
  await expect(fetchIPFSMetadata(BURI, "1")).rejects.toThrow("HTTP 503");
  expect(calls).toEqual([`${GW}/1`]);
});

test("a page of concurrent cards shares one probe", async () => {
  stubFetch((url) =>
    url.endsWith(".json") ? json({ ok: true }) : status(404),
  );
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => fetchIPFSMetadata(BURI, String(i))),
  );
  const bareProbes = calls.filter((u) => !u.endsWith(".json"));
  expect(bareProbes).toEqual([`${GW}/0`]);
  expect(calls.filter((u) => u.endsWith(".json"))).toHaveLength(12);
});

test("plain layout is remembered too and never probes .json", async () => {
  stubFetch((url) =>
    url.endsWith(".json") ? status(404) : json({ plain: true }),
  );
  await fetchIPFSMetadata(BURI, "1");
  await fetchIPFSMetadata(BURI, "2");
  expect(calls).toEqual([`${GW}/1`, `${GW}/2`]);
});

test("a storage write failure does not reject a successful fetch", async () => {
  stubFetch(() => json({ ok: true }));
  fakeBrowser.storage.local.set = async () => {
    throw new Error("QUOTA_BYTES quota exceeded");
  };
  await expect(fetchIPFSMetadata(BURI, "1")).resolves.toEqual({ ok: true });
});
