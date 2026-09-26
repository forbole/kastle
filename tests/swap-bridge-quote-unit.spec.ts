import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import init, {
  PrivateKey,
  createTransactions,
  payToAddressScript,
  signTransaction,
} from "@/wasm/core/kaspa";
import { IGRA_ENTRY_ADDRESS, igraEntryPayload } from "@/lib/bridge/bridge";
import { mineIgraEntry } from "@/lib/bridge/igra-entry";
import {
  bridgeReceived,
  l1BridgeSplit,
  swapMinReceived,
  swapPathAmountIn,
} from "@/lib/swap-bridge-quote";

test("the fee collector's 0.75% comes off the routed amount only", () => {
  expect(String(swapPathAmountIn(10_000n, true))).toBe("9925");
  expect(String(swapPathAmountIn(10_000n, false))).toBe("10000");
});

test("min received matches the executor's slippage floor", () => {
  expect(String(swapMinReceived(1_000_000n, 0.5))).toBe("995000");
  expect(String(swapMinReceived(1_000_000n, 2))).toBe("980000");
});

test("L1 bridge pays 0.2 KAS + 0.75% to Kastle and the rest to the entry", () => {
  const { kastleFee, entry } = l1BridgeSplit(100);
  expect(kastleFee).toBeCloseTo(0.95, 10);
  expect(entry).toBeCloseTo(99.05, 10);
});

test("received per direction", () => {
  expect(bridgeReceived("kas-igra", 100)).toBeCloseTo(99.05, 10);
  // Kurve takes its 0.5 KAS upstream.
  expect(bridgeReceived("kas-kasplex", 100)).toBeCloseTo(98.55, 10);
  expect(bridgeReceived("kasplex-kas", 100)).toBeCloseTo(99.5, 10);
  expect(bridgeReceived("igra-kas", 100)).toBeUndefined();
  expect(
    bridgeReceived("igra-kas", 100, { feeRateBps: 75, upstreamFeeKas: 1 }),
  ).toBeCloseTo(98.25, 10);
});

test.describe("IGRA entry mining", () => {
  test.beforeAll(async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    await init({
      module_or_path: fs.readFileSync(
        path.join(dir, "../assets/kaspa_bg.wasm"),
      ),
    });
  });

  for (const isMainnet of [false, true]) {
    test(`id carries the prefix and survives signing (${isMainnet ? "mainnet" : "testnet"})`, async () => {
      const network = isMainnet ? "mainnet" : "testnet-10";
      const key = new PrivateKey(
        "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef",
      );
      const sender = key.toPublicKey().toAddress(network);
      const entrySompi = 5_000_000_000n;
      const base = igraEntryPayload(
        "0x000000000000000000000000000000000000dEaD",
        entrySompi,
      );
      const { transactions } = await createTransactions({
        entries: [
          {
            address: sender,
            outpoint: { transactionId: "ab".repeat(32), index: 0 },
            amount: 10_000_000_000n,
            scriptPublicKey: payToAddressScript(sender),
            blockDaaScore: 1_000n,
            isCoinbase: false,
          },
        ],
        outputs: [
          {
            address: IGRA_ENTRY_ADDRESS[isMainnet ? "mainnet" : "testnet"],
            amount: entrySompi,
          },
        ],
        priorityFee: 0n,
        changeAddress: sender.toString(),
        networkId: network,
        payload: base,
      });
      expect(transactions.length).toBe(1);

      const tx = mineIgraEntry(
        transactions[0].serializeToSafeJSON(),
        base,
        isMainnet,
      );
      const prefix = isMainnet ? "97b1" : "97b4";
      expect(tx.id.startsWith(prefix)).toBe(true);
      // Only the trailing nonce moved; recipient and amount are intact.
      expect(String(tx.payload).slice(0, -8)).toBe(base.slice(0, -8));
      if (isMainnet) {
        expect(tx.version).toBe(1);
        expect(String(tx.subnetworkId)).toBe("97b10000".padEnd(40, "0"));
      }

      const minedId = tx.id;
      const signed = signTransaction(tx, [key], true);
      signed.finalize();
      expect(signed.id).toBe(minedId);
    });
  }
});
