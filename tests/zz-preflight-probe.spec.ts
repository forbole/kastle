// TEMPORARY probe, deleted after the run. Builds a real TN10 standard transfer from a live
// kascov cell and posts it to kascov preflight. Never broadcasts.
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { secp256k1, schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";

registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const { assembleStandardTransfer, patchSeat, standardSighash, splitProgram, successorProgram } = await import(
  "@/lib/kcc20/standard/build-transfer"
);
const { signTxWithScriptOptions } = await import("@/lib/wallet/sign-script");

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PF_OUT ?? "/tmp/kcc20-preflight.json";

test("preflight probe", async () => {
  test.setTimeout(60_000);
  await init({
    module_or_path: fs.readFileSync(path.join(TESTS_DIR, "../assets/kaspa_bg.wasm")),
  });
  const cells = JSON.parse(fs.readFileSync("/tmp/kcc20-pf/cells.json", "utf8"));
  const tokenId: string = cells.token_id;
  const c = cells.cells[0];
  const [txid, idx] = c.outpoint.split(":");
  const amount = BigInt(c.amount_str);
  // kascov's owner is identifier_type || pubkey32.
  const ownerPub = hexToBytes(c.owner.slice(-64));

  const priv = secp256k1.utils.randomPrivateKey();
  const privHex = bytesToHex(priv);
  const throwPub = schnorr.getPublicKey(priv);
  const address = new PrivateKey(privHex).toAddress("mainnet") /* recipientPubkey is mainnet-only; script bytes are network-independent */.toString();

  // Control: rewrite the cell's owner to the throwaway key so its signature is the owner's.
  const selfOwn = process.env.PF_SELF_OWN === "1";
  const live = hexToBytes(c.program_hex);
  const redeem = selfOwn
    ? successorProgram(live, { ...splitProgram(live).state, owner: throwPub })
    : live;
  const built = assembleStandardTransfer({
    covenantId: tokenId,
    pieces: [
      {
        outpoint: { transactionId: txid, index: Number(idx) },
        value: BigInt(c.value_sompi),
        redeem,
      },
    ],
    // Selection keys on the owner; the seat is then signed with the throwaway key.
    pubkey32: selfOwn ? throwPub : ownerPub,
    recipient: address,
    amount: amount - 1n,
    funding: [
      {
        entry: {},
        address,
        outpoint: { transactionId: "ee".repeat(32), index: 0 },
        amount: 2_000_000_000n,
        scriptPublicKey: payToAddressScript(address),
        blockDaaScore: 0n,
        isCoinbase: false,
      },
    ] as never,
    address,
  });
  const tx = built.transaction;
  const inputs = tx.inputs;
  for (const s of built.family.seats) {
    const sighash = standardSighash(tx, s.inputIndex);
    const sig = concatBytes(schnorr.sign(sighash, priv), Uint8Array.of(0x01));
    inputs[s.inputIndex].signatureScript = bytesToHex(patchSeat(s, sig));
  }
  tx.inputs = inputs;
  const signed = await signTxWithScriptOptions(
    tx,
    built.fundingInputIndexes.map((inputIndex) => ({ inputIndex, signType: "All" as const })),
    privHex,
  );

  const j = JSON.parse(signed.serializeToSafeJSON());
  const spk = (h: string) => ({ version: parseInt(h.slice(0, 4), 16), script: h.slice(4) });
  const tokenInputs = new Set(built.family.seats.map((s) => s.inputIndex));
  const body = {
    version: j.version,
    inputs: j.inputs.map((i: any, n: number) => ({
      previousOutpoint: { transactionId: i.transactionId, index: i.index },
      signatureScript: i.signatureScript,
      sequence: Number(i.sequence),
      sigOpCount: i.sigOpCount,
      computeBudget: i.computeBudget,
      utxo: {
        amount: Number(i.utxo.amount),
        scriptPublicKey: spk(i.utxo.scriptPublicKey),
        blockDaaScore: Number(i.utxo.blockDaaScore),
        isCoinbase: i.utxo.isCoinbase,
        ...(tokenInputs.has(n) ? { covenantId: tokenId } : {}),
      },
    })),
    outputs: j.outputs.map((o: any) => ({
      value: Number(o.value),
      scriptPublicKey: spk(o.scriptPublicKey),
      ...(o.covenant ? { covenant: o.covenant } : {}),
    })),
    lockTime: Number(j.lockTime),
    subnetworkId: j.subnetworkId,
    gas: Number(j.gas),
    payload: j.payload ?? "",
  };
  const res = await fetch("https://kascov.io/data/testnet-10/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let response: unknown = text;
  try {
    response = JSON.parse(text);
  } catch {}
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        note: "kascov preflight probe; nothing broadcast. Token seat signed by a throwaway key that does not own the cell.",
        token: tokenId,
        cell: c.outpoint,
        cellOwner: c.owner,
        throwawayPubkey: bytesToHex(throwPub),
        transfer: String(amount - 1n),
        httpStatus: res.status,
        request: body,
        response,
      },
      null,
      2,
    ),
  );
  console.log("HTTP", res.status, "budgets", body.inputs.map((i: any) => i.computeBudget));
});
