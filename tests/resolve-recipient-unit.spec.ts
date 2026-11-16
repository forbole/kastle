import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, { Address } from "@/wasm/core/kaspa";
import { getDotk } from "@/lib/dotk/client";
import { resolveRecipient } from "@/lib/names/resolveRecipient";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "mainnet";
const ADDRESS =
  "kaspa:qp6r0d88yj4fazlj057wc35245jfgs87n9jn6nahfg223996dfukvgpgq6pcp";
const TESTNET_ADDRESS =
  "kaspatest:qqz6pwtwxa5dds2qssxpuc28lnrnnvx48ymdcqyzju0n58dcg5p9cme645x4v";
const WRONG_NETWORK = "This address belongs to a different network";

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// Stub the shared dotK instance's resolver and record what it was asked.
function stubDotk(result: unknown) {
  const calls: string[] = [];
  (getDotk(NETWORK) as unknown as { recipientFor: unknown }).recipientFor =
    async (name: string) => {
      calls.push(name);
      return result;
    };
  return calls;
}

function setup(owner?: string) {
  const kns: string[] = [];
  return {
    kns,
    fetchDomainInfo: async (domain: string) => {
      kns.push(domain);
      return { data: { owner } };
    },
  };
}

test("`.kas` resolves through KNS, never dotK", async () => {
  const dotkCalls = stubDotk({ kind: "name", address: ADDRESS });
  const { kns, fetchDomainInfo } = setup(ADDRESS);
  const out = await resolveRecipient("alice.kas", {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: true,
  });
  expect(out).toEqual({ address: ADDRESS, domain: "alice.kas" });
  expect(kns).toEqual(["alice.kas"]);
  expect(dotkCalls).toEqual([]);
});

test("`.k` with the flag ON resolves through dotK", async () => {
  const dotkCalls = stubDotk({ kind: "name", address: ADDRESS });
  const { kns, fetchDomainInfo } = setup();
  const out = await resolveRecipient(" alice.k ", {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: true,
  });
  expect(out).toEqual({ address: ADDRESS, domain: "alice.k" });
  // resolveRecipient now trims once up front, so the client sees the
  // normalized name rather than the raw " alice.k " the caller typed.
  expect(dotkCalls).toEqual(["alice.k"]);
  expect(kns).toEqual([]);
});

test("`.k` with the flag OFF falls through to address validation", async () => {
  const dotkCalls = stubDotk({ kind: "name", address: ADDRESS });
  const { fetchDomainInfo } = setup();
  const out = await resolveRecipient("alice.k", {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: false,
  });
  expect(out).toEqual({});
  expect(dotkCalls).toEqual([]);
});

test("a bare string goes to Address.validate", async () => {
  const dotkCalls = stubDotk({ kind: "name", address: ADDRESS });
  const { kns, fetchDomainInfo } = setup();
  const opts = { fetchDomainInfo, networkId: NETWORK, dotk: true };
  expect(await resolveRecipient(ADDRESS, opts)).toEqual({ address: ADDRESS });
  expect(await resolveRecipient("alice", opts)).toEqual({});
  expect(dotkCalls).toEqual([]);
  expect(kns).toEqual([]);
});

test("dotK null address or fault is refused, fault surfaced", async () => {
  const { fetchDomainInfo } = setup();
  const opts = { fetchDomainInfo, networkId: NETWORK, dotk: true };

  stubDotk({ kind: "name", address: null, fault: "expired" });
  expect(await resolveRecipient("a.k", opts)).toEqual({ fault: "expired" });

  stubDotk({ kind: "name", address: null });
  const nullOut = await resolveRecipient("a.k", opts);
  expect(nullOut.address).toBeUndefined();

  // A fault wins even when an address came back with it.
  stubDotk({ kind: "name", address: ADDRESS, fault: "disputed" });
  expect(await resolveRecipient("a.k", opts)).toEqual({ fault: "disputed" });
});

test("a valid address on the other network is refused (KASTLE-T)", async () => {
  const { fetchDomainInfo } = setup();
  // The WASM validator alone accepts it: it is network-agnostic.
  expect(Address.validate(TESTNET_ADDRESS)).toBe(true);
  const out = await resolveRecipient(TESTNET_ADDRESS, {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: true,
  });
  expect(out).toEqual({ fault: WRONG_NETWORK });
  expect(out.address).toBeUndefined();
});

test("a KNS owner on the other network is refused", async () => {
  const { fetchDomainInfo } = setup(TESTNET_ADDRESS);
  const out = await resolveRecipient("alice.kas", {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: true,
  });
  expect(out).toEqual({ fault: WRONG_NETWORK });
});

test("a dotK address on the other network is refused", async () => {
  stubDotk({ kind: "name", address: TESTNET_ADDRESS });
  const { fetchDomainInfo } = setup();
  const out = await resolveRecipient("alice.k", {
    fetchDomainInfo,
    networkId: NETWORK,
    dotk: true,
  });
  expect(out).toEqual({ fault: WRONG_NETWORK });
});

test("a testnet id accepts testnet and refuses mainnet addresses", async () => {
  const { fetchDomainInfo } = setup();
  const opts = { fetchDomainInfo, networkId: "testnet-10", dotk: false };
  expect(await resolveRecipient(TESTNET_ADDRESS, opts)).toEqual({
    address: TESTNET_ADDRESS,
  });
  expect(await resolveRecipient(ADDRESS, opts)).toEqual({
    fault: WRONG_NETWORK,
  });
});

test("the network id is normalised before the prefix check", async () => {
  const { fetchDomainInfo } = setup();
  for (const networkId of ["Mainnet", " mainnet "]) {
    const opts = { fetchDomainInfo, networkId, dotk: false };
    expect(await resolveRecipient(ADDRESS, opts)).toEqual({ address: ADDRESS });
    expect(await resolveRecipient(TESTNET_ADDRESS, opts)).toEqual({
      fault: WRONG_NETWORK,
    });
  }
});

test("an id outside the table never refuses a valid address", async () => {
  const { fetchDomainInfo } = setup();
  for (const networkId of [undefined, "devnet", "simnet", "testnet-11"]) {
    const opts = { fetchDomainInfo, networkId, dotk: false };
    expect(await resolveRecipient(ADDRESS, opts)).toEqual({ address: ADDRESS });
    expect(await resolveRecipient(TESTNET_ADDRESS, opts)).toEqual({
      address: TESTNET_ADDRESS,
    });
  }
});
