import fs from "node:fs";
import { expect, test } from "@playwright/test";
import init, {
  PrivateKey,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import {
  parseKaspaSendRequest,
  MAX_KASPA_SEND_OUTPUTS,
} from "@/lib/kaspa-send-request";

const output = { address: "kaspa:recipient", amount: "20000000" };
test("normalizes legacy sends without losing priority fee or payload", () => {
  expect(
    parseKaspaSendRequest({
      toAddress: output.address,
      sompi: 20_000_000,
      options: { priorityFee: 123, payload: "aabb" },
    }),
  ).toEqual({
    outputs: [output],
    options: { priorityFee: "123", payload: "aabb" },
  });
});
test("preserves every output, order, duplicates and exact amounts", () => {
  const outputs = [output, { ...output, amount: "9007199254740993" }, output];
  expect(parseKaspaSendRequest({ outputs }).outputs).toEqual(outputs);
});
for (const amount of [
  "0",
  "19999999",
  "-1",
  "1.5",
  "2e7",
  " 20000000",
  "020000000",
  "18446744073709551616",
]) {
  test(`rejects invalid output amount ${amount}`, () => {
    expect(() =>
      parseKaspaSendRequest({ outputs: [{ ...output, amount }] }),
    ).toThrow();
  });
}
test("rejects empty, oversized, mixed and unknown request fields", () => {
  for (const request of [
    { outputs: [] },
    { outputs: Array(MAX_KASPA_SEND_OUTPUTS + 1).fill(output) },
    { outputs: [output], toAddress: output.address, sompi: 20_000_000 },
    { outputs: [{ ...output, memo: "not a per-output KAS memo" }] },
    { outputs: [output], options: { allowPartial: true } },
  ])
    expect(() => parseKaspaSendRequest(request)).toThrow();
});
test("rejects sum overflow and unsafe legacy numbers", () => {
  expect(() =>
    parseKaspaSendRequest({
      outputs: [{ ...output, amount: "18446744073709551615" }, output],
    }),
  ).toThrow();
  expect(() =>
    parseKaspaSendRequest({
      outputs: [{ ...output, amount: "18446744073709551615" }],
      options: { priorityFee: "1" },
    }),
  ).toThrow();
  for (const sompi of [
    20_000_000.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
  ]) {
    expect(() =>
      parseKaspaSendRequest({ toAddress: output.address, sompi }),
    ).toThrow();
  }
});
test("rejects malformed fee and payload", () => {
  for (const options of [
    { priorityFee: "-1" },
    { priorityFee: "1.1" },
    { payload: "abc" },
    { payload: "xx" },
  ]) {
    expect(() =>
      parseKaspaSendRequest({ outputs: [output], options }),
    ).toThrow();
  }
});
test("the real generator includes both recipients and exact values in one transaction", async () => {
  await init({
    module_or_path: fs.readFileSync(
      new URL("../assets/kaspa_bg.wasm", import.meta.url),
    ),
  });
  const address = (value: string) =>
    new PrivateKey(value.padStart(64, "0")).toPublicKey().toAddress("mainnet");
  const sender = address("1");
  const recipients = [address("2"), address("3")];
  const request = parseKaspaSendRequest({
    outputs: recipients.map((a, i) => ({
      address: a.toString(),
      amount: String(100_000_000 + i),
    })),
  });
  const { transactions } = await createTransactions({
    entries: [
      {
        address: sender,
        outpoint: { transactionId: "ab".repeat(32), index: 0 },
        amount: 500_000_000n,
        scriptPublicKey: payToAddressScript(sender),
        blockDaaScore: 1_000n,
        isCoinbase: false,
      },
    ],
    outputs: request.outputs.map((o) => ({
      address: o.address,
      amount: BigInt(o.amount),
    })),
    priorityFee: 0n,
    changeAddress: sender.toString(),
    networkId: "mainnet",
  });
  expect(transactions).toHaveLength(1);
  for (const [i, recipient] of recipients.entries()) {
    const paid = transactions[0].transaction.outputs.filter(
      (o) =>
        o.scriptPublicKey.toString() ===
        payToAddressScript(recipient).toString(),
    );
    expect(paid).toHaveLength(1);
    expect(paid[0].value).toBe(BigInt(100_000_000 + i));
  }
});
