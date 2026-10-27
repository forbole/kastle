import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { kcc20 } from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import init, {
  addressFromScriptPublicKey,
  PrivateKey,
  payToAddressScript,
  payToScriptHashScript,
  RpcClient,
} from "@/wasm/core/kaspa";
import {
  decimalsError,
  fetchKcc20Tokens,
  isOwnedBy,
  KRON_HOSTS,
  shouldIncludeToken,
  verifiedMeta,
} from "@/lib/kcc20";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

test("a kcc20 state counts only for the wallet that can spend it", () => {
  const key = (seed: string) => new PrivateKey(seed.repeat(64));
  const xonly = (k: PrivateKey) =>
    hexToBytes(`0x${k.toPublicKey().toXOnlyPublicKey().toString()}`);
  const mine = key("1");
  const walletSpk = payToAddressScript(mine.toAddress("mainnet")).script;

  expect(isOwnedBy(kcc20.pubkeyOwned(xonly(mine), 5n), walletSpk)).toBe(true);
  expect(isOwnedBy(kcc20.pubkeyOwned(xonly(key("2")), 5n), walletSpk)).toBe(
    false,
  );
  // A curve or pool holds by covenant id; that is never the wallet's balance.
  expect(isOwnedBy(kcc20.covenantIdOwned(xonly(mine), 5n), walletSpk)).toBe(
    false,
  );
});

test("a kcc20 token shows only with verified metadata and a non-zero balance", () => {
  const meta = { symbol: "KRON", name: "Kron", decimals: 8 };

  expect(shouldIncludeToken(meta, 5n)).toBe(true);
  // Registry entry missing or failed verification: hidden, never raw units.
  expect(shouldIncludeToken(undefined, 5n)).toBe(false);
  expect(shouldIncludeToken(meta, 0n)).toBe(false);
});

test("a kcc20 token whose verification throws is dropped, not the whole list", async () => {
  const entry = {
    network: "mainnet",
    covenantId: "ab".repeat(32),
    symbol: "KRON",
    name: "Kron",
    decimals: 8,
    extensions: { genesisTxid: "cd".repeat(32) },
  } as unknown as Parameters<typeof verifiedMeta>[0];

  // A non-string REST base makes kaspaRestFetchTx throw: a real rejection.
  expect(
    await verifiedMeta(entry, undefined as unknown as string),
  ).toBeUndefined();
});

test("amounts with more decimals than the token are rejected, not rounded", () => {
  expect(decimalsError("0.6", 0, "TKN")).toMatch(/no decimal places/);
  expect(decimalsError("1.234", 2, "TKN")).toMatch(/at most 2 decimal/);
  expect(decimalsError("1.23", 2, "TKN")).toBeUndefined();
  expect(decimalsError("5", 0, "TKN")).toBeUndefined();
  expect(decimalsError("", 0, "TKN")).toBeUndefined();
});

// ─── testnet-10 ─────────────────────────────────────────────────────────────

// Recorded once from the KTEST wallet on testnet-10.
const TN10_ADDRESS =
  "kaspatest:qqz6pwtwxa5dds2qssxpuc28lnrnnvx48ymdcqyzju0n58dcg5p9cme645x4v";
// The testnet-10 REST API from screens/Settings, which hangs the node test
// loader when imported.
const TN10_REST_API = "https://api-tn10.kaspa.org";
const KTEST_COVID =
  "06d073cefa3c0bcb842c8acc0da15d80cca2262293d8fb61344734ce925c6516";
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(TESTS_DIR, "kcc20-tn10", name), "utf8"));

/** Serves the recorded fixtures for every host the fetch goes to. */
async function withTn10Fetch<T>(run: () => Promise<T>) {
  const realFetch = globalThis.fetch;
  const hosts = KRON_HOSTS["testnet-10"];
  const routes: Record<string, unknown> = {
    [`${hosts.indexer}/address/${encodeURIComponent(TN10_ADDRESS)}/tokenlist`]:
      fixture("indexer-tokenlist.json"),
    [`${hosts.indexer}/token/KTEST/address/${encodeURIComponent(TN10_ADDRESS)}/utxos`]:
      fixture("indexer-utxos.json"),
    [`${hosts.registry}/api/registry/tokenlist`]: fixture(
      "registry-tokenlist.json",
    ),
    [`${TN10_REST_API}/transactions/1c54c07de427e2409b23f77417c0f7f68c0b6a16b8e535ca77f42134bb9d4094?outputs=true`]:
      fixture("genesis-tx.json"),
  };
  try {
    globalThis.fetch = (async (url: string) =>
      url in routes
        ? Response.json(routes[url])
        : new Response(null, { status: 404 })) as typeof fetch;
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Node stub: echoes the indexer's outpoints as live at their P2SH. */
function tn10Rpc() {
  return {
    getUtxosByAddresses: async (addresses: string[]) => ({
      entries: fixture("indexer-utxos.json").result.map(
        (u: {
          outpoint: { transactionId: string; index: number };
          amount: string;
          redeemScriptHex: string;
        }) => {
          const address = addressFromScriptPublicKey(
            payToScriptHashScript(hexToBytes(`0x${u.redeemScriptHex}`)),
            "testnet-10",
          )!.toString();
          expect(address.startsWith("kaspatest:")).toBe(true);
          expect(addresses).toContain(address);
          return {
            outpoint: u.outpoint,
            address,
            entry: { covenantId: KTEST_COVID, amount: u.amount },
          };
        },
      ),
    }),
  } as unknown as RpcClient;
}

test("kcc20 hosts: testnet-10 resolves the krontest hosts, mainnet unchanged", () => {
  expect(KRON_HOSTS["testnet-10"]).toEqual({
    indexer: "https://idx.krontest.xyz/v1/kcc20",
    registry: "https://api.krontest.xyz",
    registryNetwork: "testnet-10",
  });
  expect(KRON_HOSTS.mainnet).toEqual({
    indexer: "https://idx.kron.technology/v1/kcc20",
    registry: "https://api.kron.technology",
    registryNetwork: "mainnet",
  });
});

test("a testnet-10 kcc20 token reaches the asset list with its verified balance", async () => {
  const { tokens } = await withTn10Fetch(() =>
    fetchKcc20Tokens(TN10_ADDRESS, tn10Rpc(), TN10_REST_API, {
      network: "testnet-10",
    }),
  );
  // Amount via String(): a failing bigint expect crash-loops the worker.
  expect(
    tokens.map((t) => [t.covenantId, String(t.amount), t.meta?.symbol]),
  ).toEqual([[KTEST_COVID, "110000", "KTEST"]]);
});

test("the mainnet registry filter ignores a testnet-10 entry", async () => {
  const { tokens } = await withTn10Fetch(() =>
    fetchKcc20Tokens(TN10_ADDRESS, tn10Rpc(), TN10_REST_API, {
      network: "testnet-10",
      // Testnet data, but filtered as mainnet: no entry, so no metadata.
      hosts: { ...KRON_HOSTS["testnet-10"], registryNetwork: "mainnet" },
    }),
  );
  expect(tokens.map((t) => t.covenantId)).toEqual([]);
});
