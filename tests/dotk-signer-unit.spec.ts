import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Dotk } from "@dotk/sdk";
import {
  Registrar,
  toSafeJson,
  type SpendableUtxo,
  type Tx,
} from "@dotk/sdk-tx";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import { makeDotkSigner } from "@/lib/dotk/signer";
import { signTxWithScriptOptions } from "@/lib/wallet/sign-script";
import { deedAddressOfState } from "@dotk/sdk-tx";
import { Transaction, type RpcClient } from "@/wasm/core/kaspa";
import { makeTxNode } from "@/lib/dotk/node";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = "testnet-10";
// Throwaway key — unit tests only, never funded.
const TEST_KEY =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const spkOf = (address: string) => {
  const spk = payToAddressScript(address);
  return { script: spk.script, version: spk.version };
};

// Offline: the node is a stub, the wallet is the real signTxWithScriptOptions
// over a throwaway key, and `Registrar.submit` itself runs sdk-tx's
// applySignatures -> verifySignature on every owner seat and funding input
// before it sends, throwing SigningError on a signature it does not accept.
async function transferWith(signKey: string) {
  const key = new PrivateKey(TEST_KEY);
  const address = key.toPublicKey().toAddress(NETWORK).toString();
  const dotk = new Dotk({ network: NETWORK, api: null });
  const account = { address, ...dotk.ownerOf(address) };
  const recipient = key.toPublicKey().toAddress(NETWORK).toString();
  const other = new PrivateKey(
    "0000000000000000000000000000000000000000000000000000000000000001",
  )
    .toPublicKey()
    .toAddress(NETWORK)
    .toString();
  expect(recipient).toBe(address);

  const name = "kastle-proof";
  const deedAddress = deedAddressOfState(dotk.protocol, {
    key: dotk.keyOf(name),
    ownerType: account.ownerType,
    owner: account.owner,
    name,
  });
  const deedSpk = spkOf(deedAddress);
  const fundSpk = spkOf(address);
  const deedUtxo: SpendableUtxo = {
    outpoint: { transactionId: "aa".repeat(32), index: 0 },
    amount: 100_000_000n,
    scriptPublicKey: deedSpk.script,
    scriptVersion: deedSpk.version,
    blockDaaScore: 1000n,
    isCoinbase: false,
    covenantId: dotk.protocol.registryCovenantId,
  };
  const fundUtxo: SpendableUtxo = {
    outpoint: { transactionId: "bb".repeat(32), index: 1 },
    amount: 5_000_000_000n,
    scriptPublicKey: fundSpk.script,
    scriptVersion: fundSpk.version,
    blockDaaScore: 1000n,
    isCoinbase: false,
    covenantId: null,
  };

  const sent: Tx[] = [];
  const signCalls: { ownerSigInputs: number[] }[] = [];
  const signer = makeDotkSigner({
    signTx: (tx, scripts) =>
      signTxWithScriptOptions(tx, scripts ?? [], signKey),
  });
  const registrar = new Registrar({
    dotk,
    signer: {
      supportsOwnerScheme: signer.supportsOwnerScheme,
      sign: (req) => {
        signCalls.push({ ownerSigInputs: req.ownerSigInputs });
        return signer.sign(req);
      },
    },
    account,
    node: {
      utxosOf: async (a) =>
        a === deedAddress ? [deedUtxo] : a === address ? [fundUtxo] : [],
      feerate: async () => 1000,
      submit: async (tx) => {
        sent.push(tx);
        return "cc".repeat(32);
      },
    },
  });

  const plan = await registrar.planTransfer(name, other);
  return { registrar, plan, sent, signCalls, other };
}

test("dotK transfer signed through the Kastle adapter is accepted by sdk-tx", async () => {
  const { registrar, plan, sent, signCalls, other } =
    await transferWith(TEST_KEY);
  expect(plan.ownerSigInputs).toEqual([0]);
  expect(plan.recipient).toBe(other);

  // Throws SigningError if sdk-tx rejects any signature the adapter produced.
  const txId = await registrar.submit(plan);
  expect(txId).toBe("cc".repeat(32));

  expect(signCalls).toHaveLength(1);
  const tx = sent[0];
  expect(tx.version).toBe(1);
  // Seat 0: the 65-byte zero placeholder was patched with a real signature.
  expect(tx.inputs[0].signatureScript).not.toContain("41" + "00".repeat(65));
  // Funding input signed by the wallet.
  expect(tx.inputs.length).toBeGreaterThan(1);
  expect(tx.inputs[1].signatureScript.length).toBeGreaterThan(0);
  // The wasm Transaction round-trips what sdk-tx sent.
  expect(
    Transaction.deserializeFromSafeJSON(toSafeJson(tx)).inputs.length,
  ).toBe(tx.inputs.length);
});

test("makeTxNode submits a wasm Transaction, not safe JSON with a string lockTime", async () => {
  const { registrar, plan, sent } = await transferWith(TEST_KEY);
  await registrar.submit(plan);

  let submitted: unknown;
  const rpc = {
    submitTransaction: async (args: { transaction: unknown }) => {
      submitted = args.transaction;
      return { transactionId: "dd".repeat(32) };
    },
  } as unknown as RpcClient;
  const txId = await makeTxNode(() => rpc, NETWORK).submit(sent[0]);

  expect(txId).toBe("dd".repeat(32));
  expect(submitted).toBeInstanceOf(Transaction);
  expect(typeof (submitted as Transaction).lockTime).not.toBe("string");
  expect((submitted as Transaction).inputs.length).toBe(sent[0].inputs.length);
});

test("a signature from the wrong key is rejected by sdk-tx and never sent", async () => {
  const { registrar, plan, sent } = await transferWith(
    "0000000000000000000000000000000000000000000000000000000000000002",
  );
  await expect(registrar.submit(plan)).rejects.toThrow();
  expect(sent).toHaveLength(0);
});

test("supportsOwnerScheme accepts Schnorr pubkey owners only", async () => {
  const signer = makeDotkSigner({ signTx: async (tx) => tx });
  expect(signer.supportsOwnerScheme(0)).toBe(true);
  expect(signer.supportsOwnerScheme(3) /* ScriptHash */).toBe(false);
  expect(signer.supportsOwnerScheme(4) /* CovenantId */).toBe(false);
});
