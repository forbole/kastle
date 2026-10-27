import { client, covenantSelect, curve, kcc20, spend } from "@kronsdk/kron-sdk";
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
  classifiedPieces,
  KascovFetchers,
  KRON_HOSTS,
  Kcc20Piece,
  Kcc20Token,
  KronNetwork,
  standardSpendPieces,
} from "@/lib/kcc20";
import {
  assembleStandardTransfer,
  signStandardSeats,
  StandardFamily,
} from "./standard/build-transfer";

// ADR-009: the covenant is compiled for at most 3 token inputs and outputs.
export const MAX_TOKEN_INPUTS = 3;

// Kastle's KRON partner tag, committed on-chain as tx.payload so trades are attributed.
const KRON_PARTNER_REF = "kastlewallet";

export class Kcc20TransferError extends Error {
  constructor(
    readonly code:
      | "invalid-recipient"
      | "invalid-amount"
      | "insufficient-balance"
      | "fragmented"
      | "insufficient-funding"
      | "unsupported-schema",
    message: string,
  ) {
    super(message);
  }
}

type Outpoint = { transactionId: string; index: number };

type Funding = {
  amount: bigint | number | string;
  outpoint: Outpoint;
  entry: { covenantId?: unknown };
};

export type BuiltKcc20Transfer = {
  transaction: Transaction;
  fundingInputIndexes: number[];
  // The wallet UTXOs spent as funding, so a rebuild can pin one of them.
  fundingOutpoints: Outpoint[];
  // Network fee in sompi.
  fee: bigint;
  // Token base units actually signed.
  amount: bigint;
  // Sompi leaving the wallet's plain KAS: the fee plus the dust the covenant outputs carry beyond their inputs.
  kasDebit: bigint;
  // Set for a KCC-20 standard spend: its token seats still hold placeholder signatures.
  standard?: { plan: StandardFamily; pubkey32: Uint8Array };
};

const unsupportedSchema = () =>
  new Kcc20TransferError(
    "unsupported-schema",
    "KCC-20 standard pieces have no send builder in this version",
  );

const ADDRESS_PREFIX: Record<KronNetwork, { prefix: string; label: string }> = {
  mainnet: { prefix: "kaspa:", label: "mainnet" },
  "testnet-10": { prefix: "kaspatest:", label: "testnet" },
};

/** The recipient's x-only pubkey; only a plain Schnorr address on `network` can hold a presence-owned balance. */
export function recipientPubkey(
  address: string,
  network: KronNetwork = "mainnet",
): Uint8Array {
  const { prefix, label } = ADDRESS_PREFIX[network];
  let script: string | undefined;
  try {
    if (address.startsWith(prefix)) script = payToAddressScript(address).script;
  } catch {
    // falls through to the error below
  }
  const owner = script && /^20([0-9a-f]{64})ac$/.exec(script)?.[1];
  if (!owner) {
    throw new Kcc20TransferError(
      "invalid-recipient",
      `Recipient must be a Kaspa ${label} address starting with ${prefix}q`,
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
  // Only format the fragmented error.
  decimals = 0,
  action = "send",
  maxInputs = MAX_TOKEN_INPUTS,
) {
  const sendable = pieces
    .filter(
      (p) =>
        p.state.identifierType === kcc20.IDENTIFIER.ADDRESS &&
        !p.state.isMinter,
    )
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
  if (sum < amount || picked.length > maxInputs) {
    const max = sendable
      .slice(0, maxInputs)
      .reduce((s, p) => s + p.state.amount, 0n);
    throw new Kcc20TransferError(
      "fragmented",
      `Balance is split across more than ${maxInputs} pieces; ${action} at most ${formatUnits(max, decimals)} at once`,
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
  fetchKascov,
  network = "mainnet",
}: {
  token: Pick<
    Kcc20Token,
    "tick" | "covenantId" | "meta" | "family" | "extensionCommitment"
  >;
  address: string;
  recipient: string;
  amount: bigint;
  rpc: RpcClient;
  feeRate?: number;
  // Standard tokens only; defaults to live kascov.
  fetchKascov?: KascovFetchers;
  // The wallet's network; recipient, indexer, fee and fee address follow it.
  network?: KronNetwork;
}): Promise<BuiltKcc20Transfer> {
  if (amount <= 0n) {
    throw new Kcc20TransferError("invalid-amount", "Amount must be positive");
  }
  recipientPubkey(recipient, network);
  if (token.family === "kcc20-standard") {
    const pubkey32 = recipientPubkey(address, network);
    // Same kascov cells, re-proven against the node, as the row the user picked.
    const [pieces, { entries }] = await Promise.all([
      standardSpendPieces(token, address, rpc, fetchKascov),
      rpc.getUtxosByAddresses([address]),
    ]);
    const { family: plan, ...built } = assembleStandardTransfer({
      covenantId: token.covenantId,
      pieces,
      pubkey32,
      recipient,
      amount,
      funding: entries,
      address,
      feeRate,
      network,
    });
    return { ...built, standard: { plan, pubkey32 } };
  }

  const indexer = new client.IndexerClient(KRON_HOSTS[network].indexer);
  const { legacy: pieces, standard } = await classifiedPieces(
    indexer,
    rpc,
    token.tick,
    address,
    token.covenantId,
    network,
  );
  // Standard pieces never reach selectPieces, which would report them as a missing balance.
  if (pieces.length === 0 && standard.length > 0) throw unsupportedSchema();
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
    network,
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
  network = "mainnet",
}: {
  covenantId: string;
  pieces: Kcc20Piece[];
  funding: Funding[];
  address: string;
  recipient: string;
  amount: bigint;
  feeRate?: number;
  decimals?: number;
  network?: KronNetwork;
}): BuiltKcc20Transfer {
  const recipientKey = recipientPubkey(recipient, network);
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

  const funded = fundCovenantSpend({
    spend: send,
    funding: utxos,
    address,
    feeRate,
    network,
  });
  const sum = (xs: { value: bigint }[]) => xs.reduce((s, x) => s + x.value, 0n);
  return {
    ...funded,
    amount,
    kasDebit: funded.fee + sum(send.outputs) - sum(send.inputs),
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
  preferOutpoint,
  fundingComputeBudget,
  network = "mainnet",
}: {
  spend: spend.CovenantSpend;
  funding: Funding[];
  address: string;
  feeRate?: number;
  kastleFee?: bigint;
  // Spent first when still unspent: a rebuild that shares a funding input
  // with the trade it replaces can never land alongside it.
  preferOutpoint?: Outpoint;
  // Overrides the SDK's FUNDING_COMPUTE on every funding input, before the fee is priced.
  fundingComputeBudget?: number;
  network?: KronNetwork;
}): Omit<BuiltKcc20Transfer, "amount" | "kasDebit"> {
  const k = kaspa as unknown as Parameters<typeof spend.assembleNativeTx>[0];
  // Plain KAS only: a covenant-bound UTXO here would be spent as a fee input.
  const funding = utxos
    .filter((e) => !covenantSelect.normalizedCovenantId(e.entry.covenantId))
    .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1));
  const pinned = funding.findIndex(
    (e) =>
      e.outpoint.transactionId === preferOutpoint?.transactionId &&
      e.outpoint.index === preferOutpoint.index,
  );
  if (pinned > 0) funding.unshift(...funding.splice(pinned, 1));

  // The Kastle fee is taken out of change, then appended as its own output.
  const assemble = (n: number, networkFee: bigint) => {
    const asm = spend.assembleNativeTx(k, {
      spend: covenantSpend,
      fundingEntries: funding.slice(0, n),
      changeAddress: address,
      networkFee: networkFee + kastleFee,
      ref: KRON_PARTNER_REF,
    });
    if (fundingComputeBudget !== undefined) {
      const inputs = asm.transaction.inputs;
      for (const i of asm.fundingInputIndexes) {
        inputs[i].computeBudget = fundingComputeBudget;
      }
      asm.transaction.inputs = inputs;
    }
    if (kastleFee > 0n) {
      asm.transaction.outputs = [
        ...asm.transaction.outputs,
        new TransactionOutput(
          kastleFee,
          payToAddressScript(
            network === "mainnet"
              ? KASTLE_FEE_ADDRESS.mainnet
              : KASTLE_FEE_ADDRESS.testnet,
          ),
        ),
      ];
    }
    return asm;
  };

  const estimate = (asm: ReturnType<typeof assemble>) =>
    spend.estimateNativeFee(k, network, asm, feeRate);

  // The fee depends on the input count, so grow the funding set until
  // totalIn covers outputs + fee. A token input carrying less than the dust it
  // is re-emitted at (carrierShortfall) is covered by the same check.
  for (let n = 1; n <= funding.length; n++) {
    const fundingOutpoints = funding.slice(0, n).map((e) => ({
      transactionId: e.outpoint.transactionId,
      index: e.outpoint.index,
    }));
    try {
      let fee = estimate(assemble(n, 10_000n));
      let asm = assemble(n, fee);
      // The guess's large change hides the final change's storage mass:
      // re-price the final tx until its fee covers it.
      for (
        let next = estimate(asm);
        next > fee && asm.change >= curve.FEE_OUT_MIN;
        next = estimate(asm)
      ) {
        fee = next;
        asm = assemble(n, fee);
      }
      // A change below the fee-output minimum is priced out by its storage
      // mass: add an input. With none left, drop the change output (last
      // before the Kastle fee) and let the miner keep it.
      if (asm.change < curve.FEE_OUT_MIN && n < funding.length) continue;
      if (asm.change < curve.FEE_OUT_MIN) {
        const outputs = asm.transaction.outputs;
        outputs.splice(outputs.length - (kastleFee > 0n ? 2 : 1), 1);
        asm.transaction.outputs = outputs;
        return {
          transaction: asm.transaction,
          fundingInputIndexes: asm.fundingInputIndexes,
          fundingOutpoints,
          fee: fee + asm.change,
        };
      }
      return {
        transaction: asm.transaction,
        fundingInputIndexes: asm.fundingInputIndexes,
        fundingOutpoints,
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
  built: Pick<
    BuiltKcc20Transfer,
    "transaction" | "fundingInputIndexes" | "standard"
  >,
  rpc: RpcClient,
) {
  // Seats first: each is verified against the plan's key before funding is signed.
  if (built.standard) {
    await signStandardSeats(
      built.transaction,
      built.standard.plan.seats,
      built.standard.pubkey32,
      (inputIndex) => wallet.signInputDigest(built.transaction, inputIndex),
    );
  }
  const signed = await signKcc20Transfer(wallet, built);
  const { transactionId } = await rpc.submitTransaction({
    transaction: signed,
    allowOrphan: false,
  });
  return transactionId;
}
