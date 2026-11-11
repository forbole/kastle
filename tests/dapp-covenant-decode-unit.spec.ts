import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import init from "@/wasm/core/kaspa";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  decodeCovenantRequest,
  type WalletKcc20Piece,
} from "@/lib/kcc20/dapp-request";

// The kaspa.com repro is a real version-1 tx (testnet-10): input 0 spends a
// covenant piece of ae3a…, input 1 one of 2c4c…, input 2 the wallet's P2PK.
// Outputs 0,1 are bound to input 0, output 2 to input 1, output 3 (the
// wallet's change) has no covenant binding.
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(
  path.join(TESTS_DIR, "../test/fixtures/kaspacom-signtx-repro.txt"),
  "utf8",
);
const [, NETWORK, TX_JSON] = raw.match(/signTx\(\s*'([^']+)',\s*'(.*?)',/s)!;

const COVID_A =
  "ae3a6563b6374dc14c2b1bcd399c38a157f97c5a215ec26d0c33dfeaff91e5b8";
const COVID_B =
  "2c4c9e0f46a412391b26499b2f23a14c3d3a965624deafc11d72c5200340dd36";
// Output 1 re-creates input 0's P2SH, whose address the fixture spells out.
const INPUT0_P2SH =
  "kaspatest:ppm400cf87xmszgw5hum6t2jkdjuga4er2j5jzswmckgc5znv7x3u3k3tumez";
const WALLET =
  "kaspatest:qqvy0kf7yf2dzz0cmsaaf7gdt9nn6dh7ykvztdn9cev5wm0jp6dgv26v7c7mv";

const pieceA: WalletKcc20Piece = {
  outpoint: {
    transactionId:
      "c95be92b71d2858ec179cd7f021c09022d226dc63ebf882eafaa07422e096990",
    index: 0,
  },
  covenantId: COVID_A,
  family: "kron-legacy",
  amount: 1_000_000n,
  symbol: "AAA",
  decimals: 8,
};
const pieceB: WalletKcc20Piece = {
  outpoint: {
    transactionId:
      "e5aa2289b808367ec116640e98e9e9618ecb434f681750c387cfba4276df55b2",
    index: 2,
  },
  covenantId: COVID_B,
  family: "kron-legacy",
  amount: 7n,
  symbol: "",
};
const unrelated: WalletKcc20Piece = {
  ...pieceA,
  outpoint: { ...pieceA.outpoint, index: 9 },
};

const decode = (pieces: WalletKcc20Piece[]) =>
  decodeCovenantRequest(deserializeTransaction(TX_JSON), pieces, NETWORK);

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

test.describe("decodeCovenantRequest", () => {
  test("a spent wallet piece is one movement with its covenant outputs", () => {
    const result = decode([pieceA]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movements).toHaveLength(1);
    const [m] = result.movements;
    expect(m.inputIndex).toBe(0);
    expect(m.covenantId).toBe(COVID_A);
    expect(String(m.amount)).toBe("1000000");
    expect(m.symbol).toBe("AAA");
    expect(m.decimals).toBe(8);
    expect(m.destinations.map((d) => d.outputIndex)).toEqual([0, 1]);
    expect(m.destinations[1].address).toBe(INPUT0_P2SH);
    expect(m.destinations[0].address).toMatch(/^kaspatest:p/);
  });

  test("a tx that spends none of the wallet's pieces is ok with no movements", () => {
    expect(decode([unrelated])).toEqual({ ok: true, movements: [] });
    expect(decode([])).toEqual({ ok: true, movements: [] });
  });

  test("two pieces give two movements, outputs paired by authorizingInput", () => {
    const result = decode([pieceB, pieceA]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movements.map((m) => m.covenantId)).toEqual([
      COVID_A,
      COVID_B,
    ]);
    expect(result.movements.map((m) => m.inputIndex)).toEqual([0, 1]);
    expect(
      result.movements.map((m) => m.destinations.map((d) => d.outputIndex)),
    ).toEqual([[0, 1], [2]]);
    expect(result.movements[1].destinations[0].address).toMatch(/^kaspatest:p/);
    expect(result.movements[1].destinations[0].address).not.toBe(INPUT0_P2SH);
  });

  test("an output with no covenant binding is never a destination", () => {
    const result = decode([pieceA, pieceB]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = result.movements.flatMap((m) => m.destinations);
    expect(all.map((d) => d.outputIndex)).not.toContain(3);
    expect(all.map((d) => d.address)).not.toContain(WALLET);
  });

  test("a piece with unknown decimals is still a movement", () => {
    const result = decode([pieceB]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].decimals).toBeUndefined();
    expect("decimals" in result.movements[0]).toBe(false);
    expect(String(result.movements[0].amount)).toBe("7");
  });
});
