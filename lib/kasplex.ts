import { TransactionSerializable } from "viem";
import { IWallet as EthWallet } from "./ethereum/wallet/wallet-interface";
import { IWallet as KasWallet } from "./wallet/wallet-interface";
import { hexToBytes, bytesToHex, keccak256 } from "viem";
import * as zlib from "zlib";
import { kaspaToSompi } from "@/wasm/core/kaspa";

function appendUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  let combined = new Uint8Array(a.length + b.length);
  combined.set(a, 0);
  combined.set(b, a.length);
  return combined;
}

export async function sendKasplexTransaction(
  transaction: TransactionSerializable,
  ethWallet: EthWallet,
  kasWallet: KasWallet,
) {
  const ethTx = await ethWallet.signTransaction(transaction);
  const ethTxBytes = hexToBytes(ethTx as `0x${string}`);
  let payload: Uint8Array = new Uint8Array(new TextEncoder().encode("kasplex"));

  payload = appendUint8Arrays(payload, new Uint8Array([0x01]));
  payload = appendUint8Arrays(payload, ethTxBytes);

  const [txId] = await kasWallet.send(
    kaspaToSompi("0.2")!,
    await kasWallet.getAddress(),
    bytesToHex(payload).replace("0x", ""),
  );

  return [keccak256(ethTxBytes), txId] as const;
}
