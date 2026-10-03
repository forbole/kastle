import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ZKasBatchJournal } from "@/lib/zkas/batch-journal";

test("restart lookup returns only the exact original direct action and origin", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/zkas-direct-action-flow.json", import.meta.url),
      "utf8",
    ),
  );
  let value: unknown = null;
  const journal = new ZKasBatchJournal(
    {
      getValue: async <T>() => structuredClone(value) as T | null,
      updateValue: async <T>(
        _key: string,
        update: (current: T | null) => T | Promise<T>,
      ) => {
        value = structuredClone(await update(value as T | null));
      },
    },
    async () => false,
  );
  const origin = "https://matjam.mooncake.space";
  const logicalId = "11".repeat(32);
  const intent = {
    selection: {
      walletId: "fresh",
      accountIndex: 0,
      network: "mainnet" as const,
    },
    account: "zkas:" + "a".repeat(80),
    genesis: "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
    origin,
    logicalId,
    maxFeeSompi: "5000000",
    outputs: [
      {
        recipient:
          "zkas:p8vmwuwk2npzsjc4udm4zurtdpd76rwyqwma3j9fdda3lc4yhsp30tcesf54ehq29t66jysxg9mc25s",
        amountSompi: "1",
        memoHex: "4d4a333a" + "00".repeat(508),
      },
      {
        recipient: "zkas:" + "c".repeat(80),
        amountSompi: "1",
        memoHex: "4d4a333a" + "00".repeat(508),
      },
      {
        recipient: "zkas:" + "d".repeat(80),
        amountSompi: "1",
        memoHex: "4d4a333a" + "00".repeat(508),
      },
      {
        recipient:
          "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv",
        amountSompi: "10000000",
        memoHex: "00".repeat(512),
      },
    ],
  };
  const approval = {
    version: 1 as const,
    actionId: "22".repeat(16),
    idempotencyKey: logicalId,
    exactDigest: "33".repeat(32),
    commitment: "aa".repeat(32),
    fanoutDigest: "bb".repeat(32),
    birthHash: "44".repeat(32),
    sessionId: "55".repeat(16),
    sourceGeneration: "7",
    ownerPeerId: "77".repeat(16),
    recipientPeerId: "66".repeat(16),
    recipientCardHex: fixture.bobCardHex,
    kind: "invite" as const,
    referenceActionId: null,
    text: "hello",
  };
  await journal.reserveDirectFirstUse(
    intent,
    approval,
    () => {},
    async () => {},
  );
  expect(
    (await journal.findDirectAction(origin, approval.actionId))?.intent
      .logicalId,
  ).toBe(logicalId);
  expect(
    await journal.findDirectAction("https://other.example", approval.actionId),
  ).toBeUndefined();
  expect(
    await journal.findDirectAction(origin, "99".repeat(16)),
  ).toBeUndefined();
});
