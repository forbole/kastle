// Stand-ins for the hooks OptimizeFunds reads. One store drives them all so a
// test can switch the account or the signer's key mid-page, the way an account
// switch or a legacy-mode toggle does in the popup.
import { useSyncExternalStore } from "react";
import {
  Mnemonic,
  payToAddressScript,
  Transaction,
  type IUtxoEntry,
} from "@/wasm/core/kaspa";
import {
  HotWalletAccount,
  LegacyHotWalletAccount,
} from "@/lib/wallet/account/hot-wallet-account";
import type { ScriptOption } from "@/lib/wallet/wallet-interface";
import type { KaspaGetPublicKeysRequest } from "@/lib/service/handlers/kaspa/kaspa-get-public-keys";
import type { KaspaSignTransactionRequest } from "@/lib/service/handlers/kaspa/kaspa-sign-transaction";

export type HarnessState = {
  accountAddress: string;
  accountIndex: number;
  isLegacy: boolean;
  // what the signer's own key derives; undefined = no signer (Ledger offline)
  signerAddress: string | undefined;
  // getAddress rejects (locked keyring)
  signerFails: boolean;
  isLedger: boolean;
  // entries the node lists, per address
  entryCounts: Record<string, number>;
  // the revalidation resolves undefined (a failed SWR fetch, nothing cached),
  // or rejects with an error whose `.cause` getter throws ("hostile"), or
  // with a node-style reason naming the queried address ("node")
  utxoQuery?: "no-data" | "hostile" | "node";
  calls: {
    getAddress: number;
    signTx: number;
    submit: number;
    revalidate: number;
  };
  // isLegacy of every signTransaction the background stub received, or of
  // every signTx the Ledger device made
  signedIsLegacy: boolean[];
  // isLegacy of every other background signing request, per method
  isLegacyBy: Record<string, boolean[]>;
  // the recovery phrase behind the keyring, or on the Ledger device
  seedPhrase: string;
  // the node rejects every transaction
  submitFails: boolean;
  // the signer hooks get the raw wallet flag, as before 10e0bc6
  // (./resolve-derivation-spy.ts)
  preFix: boolean;
  // which entries the node lists: entryCounts, or FRAGMENTED
  wallet: "default" | "fragmented";
  // S: key 1 of the legacy account 1, a second address of L's account
  siblingAddress: string;
  // the Ledger device's exchanges, in order: "getPublicKeys:legacy", ...
  ledgerLog: string[];
  // what the page's lib/consolidate did (./consolidate-spy.ts): guards holds
  // the planning-time ownership check, "ok" or the error name
  guards: string[];
  plans: PlanRecord[];
  rounds: Record<string, string | number>[];
  // every transaction the node received
  submitted: SubmitRecord[];
  failed?: { errorName?: string; report?: Record<string, unknown> };
  succeeded?: boolean;
};

export type PlanRecord = {
  entries: number;
  entriesByAddress: Record<string, number>;
  // amount below 1 KAS
  smallEntries: number;
  coinbaseEntries: number;
  screen: Record<string, number | boolean>;
  // undefined: the entries already fit in one transaction
  plan?: {
    fee: string;
    inputCount: number;
    skipped: number;
    skippedCovenant: number;
    skippedImmature: number;
    // spendable entries the plan left out
    leftOut: string[];
    chunks: {
      id: string;
      fee: string;
      inputSompi: string;
      inputs: string[];
    }[];
  };
};

export type SubmitRecord = {
  id: string;
  inputs: string[];
  // inputs without a signature script
  unsigned: number;
  outputSompi: string;
};

let state: HarnessState;
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const useVersion = () => useSyncExternalStore(subscribe, () => version);

export function initStore(initial: HarnessState) {
  state = initial;
}
export function getState() {
  return state;
}
export function update(patch: Partial<HarnessState>) {
  state = { ...state, ...patch };
  version++;
  listeners.forEach((l) => l());
}

const entry = (
  address: string,
  id: number,
  amount: bigint,
  isCoinbase = false,
  blockDaaScore = 1_000n,
) => {
  const script = payToAddressScript(address);
  return {
    address,
    outpoint: { transactionId: id.toString(16).padStart(64, "0"), index: 0 },
    amount,
    scriptPublicKey: { version: script.version, script: script.script },
    blockDaaScore,
    isCoinbase,
  } as unknown as IUtxoEntry;
};

// The fragmented wallet, listed for its record address L (legacy account 1):
// - `spendable` entries on L, most below 1 KAS, every 50th 25 KAS;
// - `immatureCoinbase` coinbase payouts on L, 10 DAA scores old;
// - `sibling` entries on S, key 1 of the same legacy account, which the
//   account's key 0 cannot sign.
export const FRAGMENTED = { spendable: 401, immatureCoinbase: 1, sibling: 30 };
export const fragmentedAmount = (i: number) =>
  i % 50 === 0 ? 2_500_000_000n : 1_000_000n * BigInt(5 + ((i * 37) % 95));

function fragmentedEntries(owner: string, sibling: string): IUtxoEntry[] {
  return [
    ...Array.from({ length: FRAGMENTED.spendable }, (_, i) =>
      entry(owner, i + 1, fragmentedAmount(i)),
    ),
    ...Array.from({ length: FRAGMENTED.immatureCoinbase }, (_, i) =>
      entry(owner, 10_001 + i, 5_000_000_000n, true, 9_999_990n),
    ),
    ...Array.from({ length: FRAGMENTED.sibling }, (_, i) =>
      entry(sibling, 20_001 + i, fragmentedAmount(i)),
    ),
  ];
}

const entriesFor = (address: string): IUtxoEntry[] =>
  state.wallet === "fragmented"
    ? fragmentedEntries(address, state.siblingAddress)
    : Array.from({ length: state.entryCounts[address] ?? 0 }, (_, i) =>
        entry(address, i + 1, 206_040_000n),
      );

export function useWalletManager() {
  useVersion();
  return {
    wallet: {
      id: "wallet-1",
      type: state.isLedger ? "ledger" : "mnemonic",
      isLegacyWalletEnabled: state.isLegacy,
    },
    account: { address: state.accountAddress, index: state.accountIndex },
  };
}

const rpcClient = {
  url: "wss://stub.invalid",
  isConnected: true,
  getBlockDagInfo: async () => ({ virtualDaaScore: 10_000_000n }),
  submitTransaction: async ({ transaction }: { transaction: Transaction }) => {
    state.calls.submit++;
    state.submitted.push({
      id: transaction.id,
      inputs: transaction.inputs.map(
        ({ previousOutpoint: o }) => `${o.transactionId}:${o.index}`,
      ),
      unsigned: transaction.inputs.filter((i) => !i.signatureScript?.length)
        .length,
      outputSompi: transaction.outputs
        .reduce((sum, o) => sum + o.value, 0n)
        .toString(),
    });
    if (state.submitFails) throw new Error("rejected by the stub node");
    return { transactionId: transaction.id };
  },
};

export function useRpcClientStateful() {
  return { rpcClient, networkId: "mainnet", isConnected: true };
}

// Like the real hooks: a fresh object every render, reading the key the
// account / legacy setting of that render derives.
function useSigner() {
  useVersion();
  const address = state.signerAddress;
  if (address === undefined) return undefined;
  return {
    getAddress: async () => {
      state.calls.getAddress++;
      if (state.signerFails) throw new Error("Keyring is locked");
      return address;
    },
    // signAndSubmitBatch refuses inputs with an empty signature script: put
    // a placeholder where the real signature would go, on every input
    signTx: async (tx: Transaction) => {
      state.calls.signTx++;
      tx.inputs = tx.inputs.map((input) => {
        input.signatureScript = "00";
        return input;
      });
      return tx;
    },
    resolveIsLegacy: async () => state.isLegacy,
  };
}

// The keyring of the "real-signer" build: one recovery phrase, both
// derivations, as the background builds them (lib/service/handlers/kaspa/utils.ts).
export const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// another wallet's phrase (BIP-39 test vector)
export const OTHER_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
export function harnessAccount(
  isLegacy: boolean,
  index: number,
  phrase = MNEMONIC,
) {
  const seed = new Mnemonic(phrase).toSeed();
  return isLegacy
    ? new LegacyHotWalletAccount(seed, index)
    : new HotWalletAccount(seed, index);
}
const keyring = (isLegacy: boolean, index: number) =>
  harnessAccount(isLegacy, index, state.seedPhrase);

const recordIsLegacy = (method: string, isLegacy: boolean) =>
  (state.isLegacyBy[method] ??= []).push(isLegacy);

export function useKaspaBackgroundSigner() {
  return {
    getPublicKeys: async ({
      accountIndex,
      isLegacy,
    }: KaspaGetPublicKeysRequest) => ({
      publicKeys: keyring(isLegacy, accountIndex).getPublicKeys(),
    }),
    signTransaction: async ({
      transactionJSON,
      scripts,
      accountIndex,
      isLegacy,
    }: KaspaSignTransactionRequest) => {
      state.calls.signTx++;
      state.signedIsLegacy.push(isLegacy);
      const signed = await keyring(isLegacy, accountIndex).signTx(
        Transaction.deserializeFromSafeJSON(transactionJSON),
        scripts,
      );
      return { signedTransactionJSON: signed.serializeToSafeJSON() };
    },
    signInputDigest: async ({ isLegacy }: { isLegacy: boolean }) => {
      recordIsLegacy("signInputDigest", isLegacy);
      return { signatureHex: "00" };
    },
    signBraidDeposit: async ({ isLegacy }: { isLegacy: boolean }) => {
      recordIsLegacy("signBraidDeposit", isLegacy);
      return { signatures: [] };
    },
    signMessage: async ({ isLegacy }: { isLegacy: boolean }) => {
      recordIsLegacy("signMessage", isLegacy);
      return { signedMessage: "" };
    },
  };
}

// The Ledger of the "real-signer" build: a device holding seedPhrase, both
// derivations. Every exchange is logged in ledgerLog.
class LedgerDevice {
  constructor(
    private readonly isLegacy: boolean,
    private readonly index: number,
  ) {}
  private exchange(what: string) {
    state.ledgerLog.push(`${what}:${this.isLegacy ? "legacy" : "standard"}`);
    return keyring(this.isLegacy, this.index);
  }
  getPublicKeys = async () => this.exchange("getPublicKeys").getPublicKeys();
  getPublicKey = async () => this.exchange("getPublicKey").getPublicKey();
  signTx = async (tx: Transaction, scripts?: ScriptOption[]) => {
    state.calls.signTx++;
    state.signedIsLegacy.push(this.isLegacy);
    return this.exchange("signTx").signTx(tx, scripts);
  };
  signInputDigest = async (tx: Transaction, inputIndex: number) =>
    this.exchange("signInputDigest").signInputDigest(tx, inputIndex);
  signMessage = async (message: string) =>
    this.exchange("signMessage").signMessage(message);
}
export class LegacyAccountFactory {
  createFromLedger(_transport: unknown, index = 0) {
    return new LedgerDevice(true, index);
  }
}
export class AccountFactory {
  createFromLedger(_transport: unknown, index = 0) {
    return new LedgerDevice(false, index);
  }
}
export function useLedgerTransport() {
  return { transport: {}, isAppOpen: true };
}

export function useKaspaHotWalletSigner() {
  const signer = useSigner();
  return state.isLedger ? undefined : signer;
}

export function useKaspaLedgerSigner() {
  const signer = useSigner();
  return state.isLedger ? signer : undefined;
}

export function useKasFeeEstimate() {
  return {};
}

export function useUtxoEntries(address: string | undefined) {
  return {
    mutate: async () => {
      state.calls.revalidate++;
      if (state.utxoQuery === "no-data") return undefined;
      if (state.utxoQuery === "node")
        throw new Error(`getUtxosByAddresses failed for ${address}`);
      if (state.utxoQuery === "hostile") {
        const error = new Error("node went away");
        Object.defineProperty(error, "cause", {
          get() {
            throw new Error("hostile cause");
          },
        });
        throw error;
      }
      return address ? entriesFor(address) : [];
    },
  };
}

export function LedgerConnectForSign() {
  return <div data-testid="ledger-connect">Connect your Ledger</div>;
}

export function GeneralHeader({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
