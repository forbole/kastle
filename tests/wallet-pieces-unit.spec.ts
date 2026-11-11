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
import { KascovFetchers } from "@/lib/kcc20";
import { KascovCell, KascovHolding } from "@/lib/kcc20/providers/kascov";
import { parseArtifact } from "@/lib/kcc20/standard/artifact";
import { encodeState, KCC20State } from "@/lib/kcc20/standard/state";
import { walletKcc20Pieces } from "@/lib/kcc20/wallet-pieces";

// The real walletKcc20Pieces against an injected indexer, registry, kascov and
// node. Redeems come from tests/fixtures/kcc20 (legacy template tail, standard
// program artifact, conformance state), built the same way as kcc20-kascov-unit.

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(TESTS_DIR, "fixtures/kcc20");
const fixture = (name: string): any =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name)).toString("utf8"));
const V = fixture("conformance.json");
const LEGACY = fixture("legacy-redeem.json");
const ARTIFACT = parseArtifact(fixture("program-artifact.json"));

const LEGACY_COVID = "ef".repeat(32);
const STD_COVID = "ab".repeat(32);

let address: string;
let ecdsaAddress: string;
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
  ecdsaAddress = key.toAddressECDSA("mainnet").toString();
  pkHex = key.toPublicKey().toXOnlyPublicKey().toString();
  xonly = hexToBytes(pkHex);
});

const outpoint = (n: number) => ({
  transactionId: n.toString(16).padStart(64, "0"),
  index: 0,
});

const p2shOf = (redeem: Uint8Array) =>
  addressFromScriptPublicKey(
    payToScriptHashScript(redeem),
    "mainnet",
  )!.toString();

/** The legacy fixture's template, materialized with an ADDRESS state owned by the wallet. */
function legacyRedeem(amount: bigint) {
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
  return kcc20.materializeKcc20Script(
    {
      script: concatBytes(
        Uint8Array.from(placeholder),
        hexToBytes(LEGACY.template_tail_hex),
      ),
      stateStart: LEGACY.state_start,
      maxIns: 4,
      maxOuts: 4,
    },
    kcc20.addressPresenceOwned(xonly, amount),
  );
}

/** The standard program artifact around a P2PK_SCHNORR state owned by the wallet. */
function standardRedeem(amount: bigint) {
  const s = V.state_encoding.state;
  const state: KCC20State = {
    amount,
    owner: xonly,
    ownerScheme: 0x00,
    borrowScheme: hexToBytes(s.borrow_scheme_hex)[0],
    borrowGuard: hexToBytes(s.borrow_guard_hex),
    extensionCommitment: hexToBytes(s.extension_commitment_hex),
  };
  return concatBytes(ARTIFACT.prefix, encodeState(state), ARTIFACT.suffix);
}

type Held = { n: number; redeem: Uint8Array; covid: string };

/** A node holding each outpoint at P2SH(redeem) under its covid. */
const node = (held: Held[]) =>
  ({
    getUtxosByAddresses: async () => ({
      entries: held.map((h) => ({
        outpoint: outpoint(h.n),
        address: p2shOf(h.redeem),
        entry: { covenantId: h.covid, amount: "1000" },
      })),
    }),
  }) as unknown as RpcClient;

/** An indexer listing `rows` and answering tokenUtxos per tick from `utxos`. */
function indexer(
  rows: unknown,
  utxos: Record<string, Held[] | Error> = {},
): client.IndexerClient {
  return {
    tokenlist: async () => rows,
    tokenUtxos: async (tick: string) => {
      const u = utxos[tick] ?? [];
      if (u instanceof Error) throw u;
      return u.map((h) => ({
        outpoint: outpoint(h.n),
        redeemScriptHex: bytesToHex(h.redeem),
      }));
    },
  } as unknown as client.IndexerClient;
}

const registry = {
  tokenlist: async () => ({ tokens: [] }),
} as unknown as client.RegistryClient;

/** kascov answering holdings and owner cells from fixed data; counts every call. */
function kascov(
  holdings: Partial<KascovHolding>[],
  cells: Record<string, KascovCell[]> = {},
  truncated = false,
) {
  const calls = { holdings: 0, ownerCells: 0 };
  const fetchers: KascovFetchers = {
    holdings: async () => {
      calls.holdings++;
      return holdings.map((h) => ({ balance: 1n, ...h }) as KascovHolding);
    },
    ownerCells: async (tokenId: string) => {
      calls.ownerCells++;
      return { cells: cells[tokenId] ?? [], truncated };
    },
  };
  return { fetchers, calls };
}

const cell = (n: number, redeem: Uint8Array, amount: bigint): KascovCell => ({
  outpoint: outpoint(n),
  programHex: bytesToHex(redeem),
  amount,
  owner: `00${pkHex}`,
  extensionCommitment: V.state_encoding.state.extension_commitment_hex,
});

const scan = (
  opts: Partial<Parameters<typeof walletKcc20Pieces>[2]>,
  rpc: RpcClient = node([]),
  who = address,
) =>
  walletKcc20Pieces(who, rpc, {
    network: "mainnet",
    standard: false,
    registry,
    ...opts,
  });

const key = (p: { outpoint: { transactionId: string; index: number } }) =>
  `${p.outpoint.transactionId}:${p.outpoint.index}`;

test("1. a legacy piece comes back with its outpoint key and amount", async () => {
  const redeem = legacyRedeem(88_936n);
  const held = [{ n: 1, redeem, covid: LEGACY_COVID }];
  const pieces = await scan(
    {
      indexer: indexer([{ tick: "LEG", covenantId: LEGACY_COVID }], {
        LEG: held,
      }),
    },
    node(held),
  );
  expect(pieces).toHaveLength(1);
  expect(key(pieces[0])).toBe(`${outpoint(1).transactionId}:0`);
  expect(String(pieces[0].amount)).toBe("88936");
  expect(pieces[0].family).toBe("kron-legacy");
  expect(pieces[0].covenantId).toBe(LEGACY_COVID);
});

test("2. more than 50 tokens in the indexer list is refused", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({
    tick: `T${i}`,
    covenantId: i.toString(16).padStart(64, "0"),
  }));
  await expect(scan({ indexer: indexer(rows) })).rejects.toThrow(
    "more than 50 KCC-20 tokens",
  );
});

test("3. a truncated kascov cell list is refused", async () => {
  const { fetchers } = kascov(
    [{ tokenId: STD_COVID }],
    { [STD_COVID]: [] },
    true,
  );
  await expect(
    scan({ indexer: indexer([]), standard: true, kascov: fetchers }),
  ).rejects.toThrow(`kascov truncated ${STD_COVID}`);
});

test("4. one token failing to load rejects the whole scan, no partial list", async () => {
  const redeem = legacyRedeem(5n);
  const held = [{ n: 1, redeem, covid: LEGACY_COVID }];
  await expect(
    scan(
      {
        indexer: indexer(
          [
            { tick: "OK", covenantId: LEGACY_COVID },
            { tick: "BAD", covenantId: STD_COVID },
          ],
          { OK: held, BAD: new Error("indexer 502") },
        ),
      },
      node(held),
    ),
  ).rejects.toThrow("indexer 502");
});

test("5. a kascov standard piece merges with a legacy piece, distinct outpoints", async () => {
  const legacy = legacyRedeem(7n);
  const std = standardRedeem(500n);
  const held = [
    { n: 1, redeem: legacy, covid: LEGACY_COVID },
    { n: 2, redeem: std, covid: STD_COVID },
  ];
  const { fetchers } = kascov(
    [{ tokenId: STD_COVID, claimedTicker: "STD", displayDecimals: 2 }],
    { [STD_COVID]: [cell(2, std, 500n)] },
  );
  const pieces = await scan(
    {
      indexer: indexer([{ tick: "LEG", covenantId: LEGACY_COVID }], {
        LEG: [held[0]],
      }),
      standard: true,
      kascov: fetchers,
    },
    node(held),
  );
  expect(pieces.map((p) => [key(p), p.family, String(p.amount)])).toEqual([
    [key({ outpoint: outpoint(1) }), "kron-legacy", "7"],
    [key({ outpoint: outpoint(2) }), "kcc20-standard", "500"],
  ]);
  expect(pieces[1]).toMatchObject({
    covenantId: STD_COVID,
    symbol: "STD",
    decimals: 2,
  });
});

test("6. standard on a network other than mainnet never calls kascov", async () => {
  const { fetchers, calls } = kascov([{ tokenId: STD_COVID }]);
  expect(
    await scan({
      network: "testnet-10",
      indexer: indexer([]),
      standard: true,
      kascov: fetchers,
    }),
  ).toEqual([]);
  expect(calls).toEqual({ holdings: 0, ownerCells: 0 });
});

test("M1: a missing indexer list is refused, not read as no tokens", async () => {
  for (const rows of [null, undefined])
    await expect(scan({ indexer: indexer(rows) })).rejects.toThrow(
      "no token list",
    );
});

test("M1: a row without a usable covenant id is refused, not skipped", async () => {
  for (const covenantId of [undefined, "", "zz"])
    await expect(
      scan({ indexer: indexer([{ tick: "X", covenantId }]) }),
    ).rejects.toThrow("without a covenant id");
});

test("M1: standard on mainnet for a non-Schnorr owner is refused", async () => {
  const { fetchers, calls } = kascov([]);
  await expect(
    scan(
      { indexer: indexer([]), standard: true, kascov: fetchers },
      node([]),
      ecdsaAddress,
    ),
  ).rejects.toThrow("Schnorr P2PK");
  expect(calls.holdings).toBe(0);
  // Legacy-only scans still serve that owner.
  expect(await scan({ indexer: indexer([]) }, node([]), ecdsaAddress)).toEqual(
    [],
  );
});

test("L4: kascov-claimed decimals outside 0..18 integers are dropped", async () => {
  const std = standardRedeem(9n);
  for (const displayDecimals of [19, 1.5, -1]) {
    const { fetchers } = kascov([{ tokenId: STD_COVID, displayDecimals }], {
      [STD_COVID]: [cell(2, std, 9n)],
    });
    const [piece] = await scan(
      { indexer: indexer([]), standard: true, kascov: fetchers },
      node([{ n: 2, redeem: std, covid: STD_COVID }]),
    );
    expect(piece.decimals).toBeUndefined();
  }
});

test("indexer row symbol and dec win when the registry lists nothing", async () => {
  const redeem = legacyRedeem(12_345n);
  const held = [{ n: 1, redeem, covid: LEGACY_COVID }];
  const [piece] = await scan(
    {
      indexer: indexer(
        [{ tick: "LEG", covenantId: LEGACY_COVID, symbol: "ROW", dec: 3 }],
        { LEG: held },
      ),
    },
    node(held),
  );
  expect(piece).toMatchObject({ symbol: "ROW", decimals: 3 });
});

test("a row without symbol or dec falls back to the registry entry", async () => {
  const redeem = legacyRedeem(12_345n);
  const held = [{ n: 1, redeem, covid: LEGACY_COVID }];
  const listed = {
    tokenlist: async () => ({
      tokens: [
        {
          network: "mainnet",
          covenantId: LEGACY_COVID,
          symbol: "REG",
          decimals: 8,
        },
      ],
    }),
  } as unknown as client.RegistryClient;
  const [piece] = await scan(
    {
      indexer: indexer([{ tick: "LEG", covenantId: LEGACY_COVID }], {
        LEG: held,
      }),
      registry: listed,
    },
    node(held),
  );
  expect(piece).toMatchObject({ symbol: "REG", decimals: 8 });
});

test("a row reporting utxos with no decoded piece is refused", async () => {
  // The indexer counts 2 utxos, but the redeem it returns is not a KCC-20 one.
  await expect(
    scan({
      indexer: indexer(
        [{ tick: "LEG", covenantId: LEGACY_COVID, utxoCount: 2 }],
        {
          LEG: [{ n: 1, redeem: new Uint8Array([0x51]), covid: LEGACY_COVID }],
        },
      ),
    }),
  ).rejects.toThrow("LEG reports 2 utxos but none decoded");
  // The same row with its piece decoded passes.
  const redeem = legacyRedeem(3n);
  const held = [{ n: 1, redeem, covid: LEGACY_COVID }];
  expect(
    await scan(
      {
        indexer: indexer(
          [{ tick: "LEG", covenantId: LEGACY_COVID, utxoCount: 1 }],
          { LEG: held },
        ),
      },
      node(held),
    ),
  ).toHaveLength(1);
});

test("a kascov-claimed cell the node does not verify is refused", async () => {
  const std = standardRedeem(500n);
  const { fetchers } = kascov([{ tokenId: STD_COVID }], {
    [STD_COVID]: [cell(2, std, 500n), cell(3, std, 500n)],
  });
  // The node holds only outpoint 2: kascov claims 2 cells, 1 verifies.
  await expect(
    scan(
      { indexer: indexer([]), standard: true, kascov: fetchers },
      node([{ n: 2, redeem: std, covid: STD_COVID }]),
    ),
  ).rejects.toThrow(`kascov claims 2 cells of ${STD_COVID} but 1 verified`);
});
