import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { client, kcc20 } from "@kronsdk/kron-sdk";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import init, {
  addressFromScriptPublicKey,
  payToScriptHashScript,
  PrivateKey,
  RpcClient,
} from "@/wasm/core/kaspa";
import { fetchKcc20Tokens, standardSpendPieces } from "@/lib/kcc20";
import { classifyRedeem } from "@/lib/kcc20/classify";
import {
  fetchOwnerCells,
  fetchOwnerMarketTransfers,
  fetchOwnerTransfers,
  fetchStandardHoldings,
  fetchStandardHoldingsWithTip,
  fetchStandardMarketPrice,
  fetchTokenEvents,
  KascovCell,
} from "@/lib/kcc20/providers/kascov";
import { parseArtifact } from "@/lib/kcc20/standard/artifact";
import { hash } from "@/lib/kcc20/standard/primitives";
import { encodeState, KCC20State } from "@/lib/kcc20/standard/state";
import { verifyStandardCells } from "@/lib/kcc20/standard/verify";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(TESTS_DIR, "fixtures/kcc20");
const COVID = "ab".repeat(32);
const OTHER_COVID = "cd".repeat(32);
const LEGACY_COVID = "ef".repeat(32);
const REST = "https://rest.test";

const fixture = (name: string): any =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name)).toString("utf8"));
const V = fixture("conformance.json");
const LEGACY = fixture("legacy-redeem.json");
const ARTIFACT = parseArtifact(fixture("program-artifact.json"));

let address: string;
let xonly: Uint8Array;
let pkHex: string;

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
  const key = new PrivateKey("01".padStart(64, "0"));
  address = key.toAddress("mainnet").toString();
  pkHex = key.toPublicKey().toXOnlyPublicKey().toString();
  xonly = hexToBytes(pkHex);
});

/** A P2PK_SCHNORR state owned by this wallet, conformance-vector borrow and extension fields. */
function ownState(amount: bigint): KCC20State {
  const s = V.state_encoding.state;
  return {
    amount,
    owner: xonly,
    ownerScheme: 0x00,
    borrowScheme: hexToBytes(s.borrow_scheme_hex)[0],
    borrowGuard: hexToBytes(s.borrow_guard_hex),
    extensionCommitment: hexToBytes(s.extension_commitment_hex),
  };
}

const program = (state: KCC20State) =>
  concatBytes(ARTIFACT.prefix, encodeState(state), ARTIFACT.suffix);

const p2shOf = (redeem: Uint8Array) =>
  addressFromScriptPublicKey(
    payToScriptHashScript(redeem),
    "mainnet",
  )!.toString();

/** The legacy fixture's template, materialized with an ADDRESS state owned by `owner`. */
function legacyRedeem(owner: Uint8Array, amount: bigint) {
  const placeholder = [
    0x20,
    ...new Array(32).fill(0),
    0x01,
    0x00,
    0x08,
    ...new Array(8).fill(0),
    0x01,
    0x00,
  ];
  const template: kcc20.Kcc20Template = {
    script: concatBytes(
      Uint8Array.from(placeholder),
      hexToBytes(LEGACY.template_tail_hex),
    ),
    stateStart: LEGACY.state_start,
    maxIns: 4,
    maxOuts: 4,
  };
  return kcc20.materializeKcc20Script(
    template,
    kcc20.addressPresenceOwned(owner, amount),
  );
}

const outpoint = (n: number) => ({
  transactionId: n.toString(16).padStart(64, "0"),
  index: 0,
});

/** A kascov cell for `redeem` at outpoint n, claiming `amount` (the program's own unless overridden). */
function cell(n: number, redeem: Uint8Array, amount: bigint): KascovCell {
  return {
    outpoint: outpoint(n),
    programHex: bytesToHex(redeem),
    amount,
    owner: `00${pkHex}`,
    extensionCommitment: V.state_encoding.state.extension_commitment_hex,
  };
}

type Held = { n: number; redeem: Uint8Array; covid: string };

/** A node holding each `held` outpoint at P2SH(redeem) under its covid; logs every address query. */
function node(held: Held[]) {
  const calls: string[][] = [];
  const rpc = {
    getUtxosByAddresses: async (addresses: string[]) => {
      calls.push(addresses);
      return {
        entries: held.map((h) => ({
          outpoint: outpoint(h.n),
          address: p2shOf(h.redeem),
          entry: { covenantId: h.covid, amount: "1000" },
        })),
      };
    },
  } as unknown as RpcClient;
  return { rpc, calls };
}

const verify = (cells: KascovCell[], rpc: RpcClient) =>
  verifyStandardCells({ cells, covenantId: COVID, rpc, walletPubkey32: xonly });

const rawCell = (c: KascovCell) => ({
  outpoint: `${c.outpoint.transactionId}:${c.outpoint.index}`,
  program_hex: c.programHex,
  amount_str: String(c.amount),
  owner: c.owner,
  extension_commitment: c.extensionCommitment,
});

const holding = (tokenId: string, ticker: string) => ({
  token_id: tokenId,
  balance_str: "1",
  claimed_ticker: ticker,
  claimed_name: `${ticker} Token`,
  display_decimals: 2,
});

type Route = (url: URL) => unknown;

/**
 * Stubs global fetch: kascov.io answers from `kascov` (a number is an HTTP
 * status), the REST genesis-tx lookup from `rest`; anything else is a test bug.
 */
async function withFetch<T>(
  { kascov, rest = () => 404 }: { kascov: Route; rest?: Route },
  run: (log: { kascov: string[]; other: string[] }) => Promise<T>,
) {
  const log = { kascov: [] as string[], other: [] as string[] };
  const reply = (body: unknown) =>
    typeof body === "number"
      ? new Response("", { status: body })
      : new Response(JSON.stringify(body));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "kascov.io") {
      log.kascov.push(url.pathname + url.search);
      return reply(kascov(url));
    }
    log.other.push(url.href);
    if (url.origin === REST) return reply(rest(url));
    throw new Error(`unexpected fetch ${url.href}`);
  }) as typeof fetch;
  try {
    return await run(log);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** A KRON indexer listing `rows`, each tick's UTXOs from `utxos`. */
const fakeIndexer = (
  rows: { tick: string; covenantId: string }[],
  utxos: Record<string, unknown[]> = {},
) =>
  ({
    tokenlist: async () => rows,
    tokenUtxos: async (tick: string) => utxos[tick] ?? [],
  }) as unknown as client.IndexerClient;

const fakeRegistry = (tokens: unknown[]) =>
  ({
    tokenlist: async () => ({ tokens }),
  }) as unknown as client.RegistryClient;

test("happy path: one holding, two owner queries, one 500 cell verifies at its p2sh", async () => {
  const redeem = program(ownState(500n));
  const p2sh = p2shOf(redeem);
  const c = cell(1, redeem, 500n);
  const { rpc, calls } = node([{ n: 1, redeem, covid: COVID }]);

  await withFetch(
    {
      kascov: (url) =>
        url.pathname.startsWith("/data/mainnet/addr/")
          ? { token_holdings: [holding(COVID, "STD")] }
          : {
              cells:
                url.searchParams.get("owner") === c.owner ? [rawCell(c)] : [],
            },
    },
    async (log) => {
      const [h] = await fetchStandardHoldings(address);
      const cells = (
        await Promise.all(
          [`00${pkHex}`, `01${bytesToHex(hash(xonly))}`].map((t) =>
            fetchOwnerCells(h.tokenId, t),
          ),
        )
      ).flatMap((p) => p.cells);
      expect(log.kascov).toHaveLength(3);
      expect(cells).toHaveLength(1);

      const pieces = await verify(cells, rpc);
      expect(pieces).toHaveLength(1);
      expect(String(pieces[0].state.amount)).toBe("500");
      expect(String(pieces[0].value)).toBe("1000");
      expect(pieces[0].tokenId).toBe(COVID);
      expect(pieces[0].family).toBe("kcc20-standard");
      expect(pieces[0].outpoint).toEqual(outpoint(1));
      // The node is asked for exactly the program's P2SH.
      expect(calls).toEqual([[p2sh]]);
    },
  );

  // The same outpoint held at any other address does not verify.
  const elsewhere = node([
    { n: 1, redeem: program(ownState(501n)), covid: COVID },
  ]);
  expect(await verify([c], elsewhere.rpc)).toEqual([]);
});

test("wrong covenant: the node holds the cell under another covenant id", async () => {
  const redeem = program(ownState(500n));
  const { rpc } = node([{ n: 1, redeem, covid: OTHER_COVID }]);
  expect(await verify([cell(1, redeem, 500n)], rpc)).toEqual([]);
});

test("amount mismatch: cell says 500, program encodes 400", async () => {
  const redeem = program(ownState(400n));
  const { rpc } = node([{ n: 1, redeem, covid: COVID }]);
  expect(await verify([cell(1, redeem, 500n)], rpc)).toEqual([]);
});

test("legacy redeem as programHex: dropped, never coerced into a standard piece", async () => {
  const redeem = legacyRedeem(xonly, 500n);
  // A real, wallet-owned legacy script: only its family can drop it.
  const classified = classifyRedeem(redeem);
  expect(classified.family).toBe("kron-legacy");
  const { rpc, calls } = node([{ n: 1, redeem, covid: COVID }]);
  expect(await verify([cell(1, redeem, 500n)], rpc)).toEqual([]);
  // Nothing decoded as standard, so the node is never asked.
  expect(calls).toEqual([]);
});

test("flag off: zero kascov requests, legacy rows only", async () => {
  const redeem = legacyRedeem(xonly, 88_936n);
  const genesisTxid = "11".repeat(32);
  const { rpc } = node([{ n: 7, redeem, covid: LEGACY_COVID }]);
  const indexer = fakeIndexer([{ tick: "LEG", covenantId: LEGACY_COVID }], {
    LEG: [{ outpoint: outpoint(7), redeemScriptHex: bytesToHex(redeem) }],
  });
  const registry = fakeRegistry([
    {
      network: "mainnet",
      covenantId: LEGACY_COVID,
      symbol: "LEG",
      name: "Legacy",
      decimals: 0,
      extensions: { genesisTxid },
    },
  ]);

  await withFetch(
    {
      // Would yield a standard row if it were ever asked.
      kascov: (url) =>
        url.pathname.startsWith("/data/mainnet/addr/")
          ? { token_holdings: [holding(COVID, "STD")] }
          : { cells: [] },
      rest: (url) =>
        url.pathname === `/transactions/${genesisTxid}`
          ? { outputs: [{ covenant_id: LEGACY_COVID }] }
          : 404,
    },
    async (log) => {
      const { tokens: rows, legacyUnavailable } = await fetchKcc20Tokens(
        address,
        rpc,
        REST,
        { indexer, registry },
      );
      expect(legacyUnavailable).toBe(false);
      expect(log.kascov).toEqual([]);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.family).toBe("kron-legacy");
      expect(row.covenantId).toBe(LEGACY_COVID);
      expect(String(row.amount)).toBe("88936");
      expect(String(row.spendable)).toBe("88936");
      expect(row.meta).toEqual({
        symbol: "LEG",
        name: "Legacy",
        decimals: 0,
        logoURI: undefined,
      });
      expect(row.extensionCommitment).toBeUndefined();
    },
  );
});

test("isolation: the first holding's cells 500 does not drop the second's row", async () => {
  const redeem = program(ownState(500n));
  const c = cell(1, redeem, 500n);
  const { rpc } = node([{ n: 1, redeem, covid: COVID }]);

  await withFetch(
    {
      kascov: (url) => {
        if (url.pathname.startsWith("/data/mainnet/addr/"))
          return {
            token_holdings: [
              holding(OTHER_COVID, "BAD"),
              holding(COVID, "GOOD"),
            ],
          };
        if (url.pathname.includes(OTHER_COVID)) return 500;
        return {
          cells: url.searchParams.get("owner") === c.owner ? [rawCell(c)] : [],
        };
      },
    },
    async (log) => {
      const { tokens: rows } = await fetchKcc20Tokens(address, rpc, REST, {
        standard: true,
        indexer: fakeIndexer([]),
        registry: fakeRegistry([]),
      });
      // Both holdings were really tried: one holdings call, two owner tuples each.
      expect(log.kascov).toHaveLength(5);
      expect(
        log.kascov.filter((u) => u.includes(OTHER_COVID)).length,
      ).toBeGreaterThan(0);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.covenantId).toBe(COVID);
      expect(row.family).toBe("kcc20-standard");
      expect(String(row.amount)).toBe("500");
      expect(String(row.spendable)).toBe("500");
      expect(row.meta).toEqual({
        symbol: "GOOD",
        name: "GOOD Token",
        decimals: 2,
        unverified: true,
      });
    },
  );
});

// Kept from the earlier draft of this spec: further drop paths.

test("a cell owned by another key is dropped", async () => {
  const other = { ...ownState(500n), owner: new Uint8Array(32).fill(7) };
  const redeem = program(other);
  const { rpc } = node([{ n: 1, redeem, covid: COVID }]);
  expect(await verify([cell(1, redeem, 500n)], rpc)).toEqual([]);
});

test("a group whose pieces disagree with their claimed extension commitment is dropped", async () => {
  const redeem = program(ownState(500n));
  const c = { ...cell(1, redeem, 500n), extensionCommitment: "11".repeat(32) };
  const { rpc } = node([{ n: 1, redeem, covid: COVID }]);
  await withFetch(
    {
      kascov: (url) =>
        url.pathname.startsWith("/data/mainnet/addr/")
          ? { token_holdings: [holding(COVID, "STD")] }
          : {
              cells:
                url.searchParams.get("owner") === c.owner ? [rawCell(c)] : [],
            },
    },
    async () => {
      expect(
        await fetchKcc20Tokens(address, rpc, REST, {
          standard: true,
          indexer: fakeIndexer([]),
          registry: fakeRegistry([]),
        }),
      ).toEqual({ tokens: [], legacyUnavailable: false });
    },
  );
});

test("kascov down: the standard path yields nothing and never throws", async () => {
  const { rpc } = node([]);
  await withFetch({ kascov: () => 503 }, async () => {
    expect(
      await fetchKcc20Tokens(address, rpc, REST, {
        standard: true,
        indexer: fakeIndexer([]),
        registry: fakeRegistry([]),
      }),
    ).toEqual({ tokens: [], legacyUnavailable: false });
  });
});

test("KRON down with the flag on: standard rows survive, the failure is flagged and logged once", async () => {
  const redeem = program(ownState(500n));
  const c = cell(1, redeem, 500n);
  const { rpc } = node([{ n: 1, redeem, covid: COVID }]);
  const downIndexer = {
    tokenlist: async () => {
      throw new Error("KRON 503");
    },
  } as unknown as client.IndexerClient;
  await withFetch(
    {
      kascov: (url) =>
        url.pathname.startsWith("/data/mainnet/addr/")
          ? { token_holdings: [holding(COVID, "STD")] }
          : {
              cells:
                url.searchParams.get("owner") === c.owner ? [rawCell(c)] : [],
            },
    },
    async () => {
      const warnings: unknown[][] = [];
      const realWarn = console.warn;
      console.warn = (...args: unknown[]) => void warnings.push(args);
      try {
        for (let poll = 0; poll < 2; poll++) {
          const { tokens: rows, legacyUnavailable } = await fetchKcc20Tokens(
            address,
            rpc,
            REST,
            {
              standard: true,
              indexer: downIndexer,
              registry: fakeRegistry([]),
            },
          );
          expect(legacyUnavailable).toBe(true);
          expect(rows).toHaveLength(1);
          expect(rows[0].family).toBe("kcc20-standard");
          expect(String(rows[0].amount)).toBe("500");
        }
      } finally {
        console.warn = realWarn;
      }
      // Two polls, one warning, carrying the error's message.
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0][0])).toContain("KRON 503");

      // Flag off keeps today's behaviour: the outage still rejects.
      await expect(
        fetchKcc20Tokens(address, rpc, REST, {
          indexer: downIndexer,
          registry: fakeRegistry([]),
        }),
      ).rejects.toThrow("KRON 503");
    },
  );
});

test("template allowlist: an off-template piece counts in amount, never in spendable", async () => {
  const canonical = program(ownState(500n));
  // Same state framing and dispatch tag, one suffix byte off: still classifies as standard.
  const offTemplate = program(ownState(300n));
  offTemplate[offTemplate.length - 1] ^= 0x01;
  expect(classifyRedeem(offTemplate).family).toBe("kcc20-standard");
  const cells = [cell(1, canonical, 500n), cell(2, offTemplate, 300n)];
  const { rpc } = node([
    { n: 1, redeem: canonical, covid: COVID },
    { n: 2, redeem: offTemplate, covid: COVID },
  ]);
  const kascov = (url: URL) =>
    url.pathname.startsWith("/data/mainnet/addr/")
      ? { token_holdings: [holding(COVID, "STD")] }
      : {
          cells:
            url.searchParams.get("owner") === cells[0].owner
              ? cells.map(rawCell)
              : [],
        };

  await withFetch({ kascov }, async () => {
    const {
      tokens: [row],
    } = await fetchKcc20Tokens(address, rpc, REST, {
      standard: true,
      indexer: fakeIndexer([]),
      registry: fakeRegistry([]),
    });
    expect(String(row.amount)).toBe("800");
    expect(String(row.spendable)).toBe("500");
    // The builder gets exactly what `spendable` counted.
    const pieces = await standardSpendPieces(row, address, rpc);
    expect(pieces.map((p) => p.outpoint)).toEqual([outpoint(1)]);
  });

  // Every piece canonical: the whole row stays spendable, so the send action shows.
  await withFetch(
    {
      kascov: (url) =>
        url.pathname.startsWith("/data/mainnet/addr/")
          ? { token_holdings: [holding(COVID, "STD")] }
          : {
              cells:
                url.searchParams.get("owner") === cells[0].owner
                  ? [rawCell(cells[0])]
                  : [],
            },
    },
    async () => {
      const {
        tokens: [row],
      } = await fetchKcc20Tokens(address, rpc, REST, {
        standard: true,
        indexer: fakeIndexer([]),
        registry: fakeRegistry([]),
      });
      expect(String(row.spendable)).toBe(String(row.amount));
      expect(row.spendable > 0n).toBe(true);
      expect(await standardSpendPieces(row, address, rpc)).toHaveLength(1);
    },
  );
});

test("paging: a full 500-cell page with omitted_over_limit marks the row truncated", async () => {
  const redeem = program(ownState(1n));
  // 500 distinct outpoints, all the same program: one group.
  const page = Array.from({ length: 500 }, (_, i) => cell(i + 1, redeem, 1n));
  const { rpc } = node(
    page.map((_, i) => ({ n: i + 1, redeem, covid: COVID })),
  );
  const kascov = (omitted: number) => (url: URL) =>
    url.pathname.startsWith("/data/mainnet/addr/")
      ? { token_holdings: [holding(COVID, "STD")] }
      : url.searchParams.get("owner") === page[0].owner
        ? { cells: page.map(rawCell), omitted_over_limit: omitted }
        : { cells: [], omitted_over_limit: 0 };
  const deps = {
    standard: true,
    indexer: fakeIndexer([]),
    registry: fakeRegistry([]),
  };

  await withFetch({ kascov: kascov(3) }, async (log) => {
    const {
      tokens: [row],
    } = await fetchKcc20Tokens(address, rpc, REST, deps);
    // One request per owner tuple, each asking for 500.
    const cellCalls = log.kascov.filter((u) => u.includes("/cells?"));
    expect(cellCalls).toHaveLength(2);
    for (const u of cellCalls) expect(u).toContain("limit=500");
    expect(String(row.amount)).toBe("500");
    expect(row.truncated).toBe(true);
  });

  // kascov reports nothing omitted: the same full page is the whole balance.
  await withFetch({ kascov: kascov(0) }, async () => {
    const {
      tokens: [row],
    } = await fetchKcc20Tokens(address, rpc, REST, deps);
    expect(String(row.amount)).toBe("500");
    expect(row.truncated).toBeUndefined();
  });
});

test("paging: without omitted_over_limit, a full page is assumed cut, a short one is not", async () => {
  const c = cell(1, program(ownState(5n)), 5n);
  const full = Array.from({ length: 3 }, () => rawCell(c));
  await withFetch(
    {
      kascov: (url) =>
        url.searchParams.get("limit") === "3"
          ? { cells: full }
          : { cells: [rawCell(c)] },
    },
    async () => {
      expect(
        (await fetchOwnerCells(COVID, c.owner, { limit: 3 })).truncated,
      ).toBe(true);
      expect((await fetchOwnerCells(COVID, c.owner)).truncated).toBe(false);
    },
  );
});

test("holdings with tip: returns the tip kascov read at; a missing tip throws", async () => {
  await withFetch(
    {
      kascov: () => ({
        token_holdings: [holding(COVID, "STD"), { token_id: "nope" }],
        tip_daa: 1234,
        tip_at_ms: 5678,
      }),
    },
    async () => {
      const { holdings, tip } = await fetchStandardHoldingsWithTip(address);
      expect(holdings.map((h) => h.tokenId)).toEqual([COVID]);
      expect(tip).toEqual({ daa: 1234, atMs: 5678 });
    },
  );
  await withFetch(
    { kascov: () => ({ token_holdings: [holding(COVID, "STD")] }) },
    async () => {
      await expect(fetchStandardHoldingsWithTip(address)).rejects.toThrow(
        "malformed holdings tip",
      );
    },
  );
});

const OWNER_KEY = "12".repeat(32);
const transferRow = (seq: number, movements: unknown[]) => ({
  txid: seq.toString(16).padStart(64, "0"),
  token_id: COVID,
  kind: "transfer",
  seq,
  tx_index: 0,
  accepting_daa: 100 + seq,
  attribution: { status: "confirmed", owner_from: OWNER_KEY, movements },
  verified_market: { market_id: OTHER_COVID, build: "KRON curve v2" },
  market_activity: { side: "buy" },
});

test("owner transfers: parses rows, drops a row with a malformed movement, passes the cursor", async () => {
  const good = {
    amount: "7",
    owner_from: OWNER_KEY,
    owner_to: `presence:${OWNER_KEY}`,
  };
  await withFetch(
    {
      kascov: (url) => ({
        transfers: [
          transferRow(2, [good]),
          transferRow(1, [
            good,
            { amount: "-1", owner_from: OWNER_KEY, owner_to: OWNER_KEY },
          ]),
        ],
        ...(url.searchParams.has("before_seq")
          ? {}
          : {
              next_before_daa: 50,
              next_before_seq: 1,
              next_before_token: COVID,
            }),
      }),
    },
    async (log) => {
      const first = await fetchOwnerTransfers(OWNER_KEY, COVID);
      expect(first.transfers).toHaveLength(1);
      const [row] = first.transfers;
      expect(String(row.movements[0].amount)).toBe("7");
      expect(row.marketId).toBe(OTHER_COVID);
      expect(row.marketSide).toBe("buy");
      expect(first.next).toEqual({
        beforeDaa: 50,
        beforeSeq: 1,
        beforeToken: COVID,
      });

      const second = await fetchOwnerTransfers(OWNER_KEY, COVID, first.next);
      expect(second.next).toBeUndefined();
      expect(log.kascov[0]).toContain(`token_id=${COVID}`);
      expect(log.kascov[1]).toContain(
        `before_daa=50&before_seq=1&before_token=${COVID}`,
      );

      // Across tokens: no token filter on the request.
      await fetchOwnerMarketTransfers(OWNER_KEY);
      expect(log.kascov[2]).not.toContain("token_id=");
    },
  );
  // kascov answers 400 to a p2pkh filter: refused before any request.
  await withFetch({ kascov: () => 500 }, async (log) => {
    await expect(
      fetchOwnerTransfers(`p2pkh:${OWNER_KEY}`, COVID),
    ).rejects.toThrow("malformed owner");
    expect(log.kascov).toHaveLength(0);
  });
});

test("owner transfers: a partial cursor is malformed", async () => {
  await withFetch(
    { kascov: () => ({ transfers: [], next_before_daa: 5 }) },
    async () => {
      await expect(fetchOwnerTransfers(OWNER_KEY, COVID)).rejects.toThrow(
        "malformed transfers cursor",
      );
    },
  );
});

test("token events: mints carry no ownerFrom; total and cursor pass through", async () => {
  await withFetch(
    {
      kascov: () => ({
        events: [
          {
            txid: "01".repeat(32),
            seq: 9,
            delta_idx: 0,
            accepting_daa: 10,
            owner_to: OWNER_KEY,
            amount_str: "100",
          },
          {
            txid: "02".repeat(32),
            seq: 8,
            delta_idx: 1,
            accepting_daa: 9,
            owner_from: "bad",
            owner_to: OWNER_KEY,
            amount_str: "1",
          },
        ],
        events_total: 2,
        next_before_seq: 8,
      }),
    },
    async (log) => {
      const page = await fetchTokenEvents(COVID, 10);
      expect(page.events).toHaveLength(1);
      expect(page.events[0].ownerFrom).toBeUndefined();
      expect(String(page.events[0].amount)).toBe("100");
      expect(page.eventsTotal).toBe(2);
      expect(page.nextBeforeSeq).toBe(8);
      expect(log.kascov[0]).toContain("order=desc&limit=100&before_seq=10");
    },
  );
});

test("market price: spot is sompi per base unit; 404 or a missing spot is no market; other failures throw", async () => {
  await withFetch(
    { kascov: () => ({ market: { spot_num_sompi: "25000000", spot_den: 2 } }) },
    async () => {
      // 12,500,000 sompi per base unit at 2 decimals = 12.5 KAS per whole token.
      expect(await fetchStandardMarketPrice(COVID, 2)).toBeCloseTo(12.5);
    },
  );
  await withFetch({ kascov: () => 404 }, async () => {
    expect(await fetchStandardMarketPrice(COVID, 0)).toBeNull();
  });
  await withFetch({ kascov: () => ({ market: { spot_den: 2 } }) }, async () => {
    expect(await fetchStandardMarketPrice(COVID, 0)).toBeNull();
  });
  await withFetch({ kascov: () => 503 }, async () => {
    await expect(fetchStandardMarketPrice(COVID, 0)).rejects.toThrow(
      "kascov 503",
    );
  });
});
