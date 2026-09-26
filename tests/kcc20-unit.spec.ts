import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { kcc20 } from "@kronsdk/kron-sdk";
import { hexToBytes } from "viem";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import { isOwnedBy } from "@/lib/kcc20";

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
