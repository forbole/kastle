import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { kcc20 } from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import {
  decimalsError,
  isOwnedBy,
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
