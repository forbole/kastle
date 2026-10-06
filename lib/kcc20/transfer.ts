import { client, covenantSelect, kcc20, spend } from "@kronsdk/kron-sdk";
import { formatUnits, hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";
import {
  payToAddressScript,
  RpcClient,
  Transaction,
  TransactionOutput,
} from "@/wasm/core/kaspa";
import { KASTLE_FEE_ADDRESS } from "@/lib/bridge/bridge";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import {
  KRON_INDEXER_URL,
  Kcc20Piece,
  Kcc20Token,
  verifiedPieces,
} from "@/lib/kcc20";

// ADR-009: the covenant is compiled for at most 3 token inputs and outputs.
export const MAX_TOKEN_INPUTS = 3;

// Standard-relay dust limit for a P2PK change output, in sompi.
const DUST_CHANGE = 546n;

export class Kcc20TransferError extends Error {
  constructor(
    readonly code:
      | "invalid-recipient"
      | "invalid-amount"
      | "insufficient-balance"
      | "fragmented"
      | "insufficient-funding",
    message: string,
  ) {
    super(message);
  }
}

type Funding = {
  amount: bigint | number | string;
  entry: { covenantId?: unknown };
};

export type BuiltKcc20Transfer = {
  transaction: Transaction;
  fundingInputIndexes: number[];
  // Network fee in sompi.
  fee: bigint;
  // Token base units actually signed.
  amount: bigint;
};

/** The recipient's x-only pubkey; only a plain mainnet Schnorr address can hold a presence-owned balance. */
export function recipientPubkey(address: string): Uint8Array {
  let script: string | undefined;
  try {
    if (address.startsWith("kaspa:"))
      script = payToAddressScript(address).script;
  } catch {
    // falls through to the error below
  }
  const owner = script && /^20([0-9a-f]{64})ac$/.exec(script)?.[1];
  if (!owner) {
    throw new Kcc20TransferError(
      "invalid-recipient",
      "Recipient must be a Kaspa mainnet address starting with kaspa:q",
    );
  }
  return hexToBytes(`0x${owner}`);
}

/**
 * Pieces to spend, largest first. Only presence-owned (ADDRESS) pieces: they
 * are authorised by a co-present wallet-signed input, while a PUBKEY-owned
 * piece needs a covenant-level signature the SDK send builder does not produce.
 */
export function selectPieces(
  pieces: Kcc20Piece[],
  amount: bigint,
  // Only formats the fragmented error's maximum.
  decimals = 0,
) {
  const sendable = pieces
    .filter((p) => p.state.identifierType === kcc20.IDENTIFIER.ADDRESS)
    .sort((a, b) => (a.state.amount < b.state.amount ? 1 : -1));
  const total = sendable.reduce((s, p) => s + p.state.amount, 0n);
  if (total < amount) {
    throw new Kcc20TransferError(
      "insufficient-balance",
      "Not enough spendable balance for this token",
    );
  }
  const picked: Kcc20Piece[] = [];
  let sum = 0n;
  for (const p of sendable) {
    if (sum >= amount) break;
    picked.push(p);
    sum += p.state.amount;
  }
  if (sum < amount || picked.length > MAX_TOKEN_INPUTS) {
    const max = sendable
      .slice(0, MAX_TOKEN_INPUTS)
      .reduce((s, p) => s + p.state.amount, 0n);
    throw new Kcc20TransferError(
      "fragmented",
      `Balance is split across more than ${MAX_TOKEN_INPUTS} pieces; send at most ${formatUnits(max, decimals)} at once`,
    );
  }
  return picked;
}

export async function buildKcc20Transfer({
  token,
  address,
  recipient,
  amount,
  rpc,
  feeRate,
}: {
  token: Pick<Kcc20Token, "tick" | "covenantId" | "meta">;
  address: string;
  recipient: string;
  amount: bigint;
  rpc: RpcClient;
  feeRate?: number;
}): Promise<BuiltKcc20Transfer> {
  if (amount <= 0n) {
    throw new Kcc20TransferError("invalid-amount", "Amount must be positive");
  }
  recipientPubkey(recipient);

  const indexer = new client.IndexerClient(KRON_INDEXER_URL);
  const pieces = await verifiedPieces(
    indexer,
    rpc,
    token.tick,
    address,
    token.covenantId,
  );
  const { entries } = await rpc.getUtxosByAddresses([address]);
  return assembleKcc20Transfer({
    covenantId: token.covenantId,
    pieces,
    funding: entries,
    address,
    recipient,
    amount,
    feeRate,
    decimals: token.meta?.decimals,
  });
}

/** The pure half of the build: node-verified pieces and wallet UTXOs in, unsigned transaction out. */
export function assembleKcc20Transfer({
  covenantId,
  pieces: allPieces,
  funding: utxos,
  address,
  recipient,
  amount,
  feeRate,
  decimals,
}: {
  covenantId: string;
  pieces: Kcc20Piece[];
  funding: Funding[];
  address: string;
  recipient: string;
  amount: bigint;
  feeRate?: number;
  decimals?: number;
}): BuiltKcc20Transfer {
  const recipientKey = recipientPubkey(recipient);
  const pieces = selectPieces(allPieces, amount, decimals);
  const k = kaspa as unknown as Parameters<typeof spend.assembleNativeTx>[0];
  const { template } = kcc20.decodeKcc20Redeem(pieces[0].redeem);

  // Covenant inputs come first, so the co-present wallet input that authorises
  // them is the first funding input, at index pieces.length.
  const send = kcc20.buildKcc20Send(
    k,
    template,
    pieces.map((p) => ({ ...p.outpoint, value: p.value, state: p.state })),
    recipientKey,
    amount,
    pieces.length,
    covenantId,
  );

  return {
    ...fundCovenantSpend({ spend: send, funding: utxos, address, feeRate }),
    amount,
  };
}

/**
 * Funds a covenant spend from the wallet's plain-KAS UTXOs and sizes the
 * network fee. A `kastleFee` is paid to KASTLE_FEE_ADDRESS as the very last
 * output, after change, so every output index the SDK lays out stays put.
 */
export function fundCovenantSpend({
  spend: covenantSpend,
  funding: utxos,
  address,
  // sompi per gram of mass.
  feeRate = spend.MIN_RELAY_FEERATE,
  kastleFee = 0n,
}: {
  spend: spend.CovenantSpend;
  funding: Funding[];
  address: string;
  feeRate?: number;
  kastleFee?: bigint;
}): Omit<BuiltKcc20Transfer, "amount"> {
  const k = kaspa as unknown as Parameters<typeof spend.assembleNativeTx>[0];
  // Plain KAS only: a covenant-bound UTXO here would be spent as a fee input.
  const funding = utxos
    .filter((e) => !covenantSelect.normalizedCovenantId(e.entry.covenantId))
    .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1));

  // The Kastle fee is taken out of change, then appended as its own output.
  const assemble = (n: number, networkFee: bigint) => {
    const asm = spend.assembleNativeTx(k, {
      spend: covenantSpend,
      fundingEntries: funding.slice(0, n),
      changeAddress: address,
      networkFee: networkFee + kastleFee,
    });
    if (kastleFee > 0n) {
      asm.transaction.outputs = [
        ...asm.transaction.outputs,
        new TransactionOutput(
          kastleFee,
          payToAddressScript(KASTLE_FEE_ADDRESS.mainnet),
        ),
      ];
    }
    return asm;
  };

  // The fee depends on the input count, so grow the funding set until
  // totalIn covers outputs + fee. A token input carrying less than the dust it
  // is re-emitted at (carrierShortfall) is covered by the same check.
  for (let n = 1; n <= funding.length; n++) {
    try {
      const fee = spend.estimateNativeFee(
        k,
        "mainnet",
        assemble(n, 10_000n),
        feeRate,
      );
      const asm = assemble(n, fee);
      // Zero change is a consensus reject and dust change a mempool reject:
      // drop the change output (last before the Kastle fee) and let the miner keep it.
      if (asm.change < DUST_CHANGE) {
        const outputs = asm.transaction.outputs;
        outputs.splice(outputs.length - (kastleFee > 0n ? 2 : 1), 1);
        asm.transaction.outputs = outputs;
        return {
          transaction: asm.transaction,
          fundingInputIndexes: asm.fundingInputIndexes,
          fee: fee + asm.change,
        };
      }
      return {
        transaction: asm.transaction,
        fundingInputIndexes: asm.fundingInputIndexes,
        fee,
      };
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith("insufficient funding")))
        throw e;
    }
  }
  throw new Kcc20TransferError(
    "insufficient-funding",
    "Not enough KAS to cover the network fee",
  );
}

/**
 * The signer bridge: only the wallet's funding inputs are signed (SIGHASH_ALL);
 * the covenant inputs already carry their signature scripts. Spelling the
 * indexes out keeps signTx off its sign-every-owned-input fallback.
 */
export function signKcc20Transfer(
  wallet: IWallet,
  built: Pick<BuiltKcc20Transfer, "transaction" | "fundingInputIndexes">,
) {
  return wallet.signTx(
    built.transaction,
    built.fundingInputIndexes.map((inputIndex) => ({
      inputIndex,
      signType: "All" as const,
    })),
  );
}

export async function sendKcc20Transfer(
  wallet: IWallet,
  built: Pick<BuiltKcc20Transfer, "transaction" | "fundingInputIndexes">,
  rpc: RpcClient,
) {
  const signed = await signKcc20Transfer(wallet, built);
  const { transactionId } = await rpc.submitTransaction({
    transaction: signed,
    allowOrphan: false,
  });
  return transactionId;
}
