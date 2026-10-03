import {
  initSync,
  PrivateAccountSigner,
} from "../../wasm/zkas-batch/zkas_browser_signer.js";
import wasmAssetUrl from "../../wasm/zkas-batch/zkas_browser_signer_bg.wasm?url";
import type { ZKasPreparedBatch } from "./batch-client";
import type { ZKasBatchIntent, ZKasSignedBytes } from "./batch-journal";
import type { PrivateBatchSigner } from "./batch-payment";

const PINNED_WASM_SHA256 =
  "390de75c80ea88159e6f47f8e5747bf3d75a504106beb2b99d2a3605c5885261";
const MAX_WASM_BYTES = 4 * 1024 * 1024;
const LOAD_DEADLINE_MS = 10_000;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/;
let ready: Promise<void> | undefined;

async function loadPinnedModule(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const controller = new AbortController();
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          reject(new Error("Private batch signer load expired"));
        }, LOAD_DEADLINE_MS);
      });
      const loading = async () => {
        const response = await fetch(wasmAssetUrl, {
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok || !response.body)
          throw new Error("Private batch signer unavailable");
        const length = response.headers.get("content-length");
        if (
          length !== null &&
          (!/^[1-9][0-9]{0,7}$/.test(length) || Number(length) > MAX_WASM_BYTES)
        )
          throw new Error("Private batch signer exceeds byte limit");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_WASM_BYTES)
              throw new Error("Private batch signer exceeds byte limit");
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (expired || controller.signal.aborted)
          throw new Error("Private batch signer load expired");
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        try {
          const digest = new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes),
          );
          const hash = Array.from(digest, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          if (expired || controller.signal.aborted)
            throw new Error("Private batch signer load expired");
          if (hash !== PINNED_WASM_SHA256)
            throw new Error("Private batch signer pin mismatch");
          initSync({ module: bytes });
        } finally {
          bytes.fill(0);
        }
      };
      try {
        await Promise.race([loading(), deadline]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
  }
  await ready;
}

function exactSignatures(
  value: unknown,
  prepared: ZKasPreparedBatch,
): { actionIndex: number; signatureHex: string }[] {
  const indices = prepared.preparedPayment?.spendAuth.map(
    (entry) => entry.actionIndex,
  );
  if (
    !Array.isArray(value) ||
    !indices ||
    value.length !== indices.length ||
    value.length > 32
  )
    throw new Error("Private batch signer returned incomplete signatures");
  const expected = new Set(indices);
  const seen = new Set<number>();
  const result: { actionIndex: number; signatureHex: string }[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Object.keys(entry).sort().join(",") !== "actionIndex,signatureHex" ||
      !Number.isSafeInteger(entry.actionIndex) ||
      !expected.has(entry.actionIndex) ||
      seen.has(entry.actionIndex) ||
      typeof entry.signatureHex !== "string" ||
      !SIGNATURE_HEX.test(entry.signatureHex)
    )
      throw new Error("Private batch signer returned invalid signatures");
    seen.add(entry.actionIndex);
    result.push({
      actionIndex: entry.actionIndex,
      signatureHex: entry.signatureHex,
    });
  }
  return result;
}

/** Wallet-private only. The caller has already fenced selection and human approval. */
export async function createPrivateBatchSigner(
  seed: Uint8Array,
  selectedAddress0: string,
  approved: ZKasBatchIntent,
  prepared: ZKasPreparedBatch | undefined,
  signal: AbortSignal,
): Promise<PrivateBatchSigner> {
  if (!(seed instanceof Uint8Array))
    throw new Error("Invalid private batch seed buffer");
  if (seed.length !== 32) {
    seed.fill(0);
    throw new Error("Invalid private batch seed buffer");
  }
  let privateSeed: Uint8Array;
  try {
    privateSeed = Uint8Array.from(seed);
  } finally {
    seed.fill(0);
  }
  let native: PrivateAccountSigner | undefined;
  let closed = false;
  let abortWait: ((reason: Error) => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    privateSeed.fill(0);
    signal.removeEventListener("abort", onAbort);
    if (native) {
      native.free();
      native = undefined;
    }
  };
  const onAbort = () => {
    close();
    abortWait?.(new Error("Private batch account request aborted"));
  };
  try {
    if (
      signal.aborted ||
      approved.selection.network !== "mainnet" ||
      selectedAddress0 !== approved.account ||
      !/^[0-9a-f]{64}$/.test(approved.genesis) ||
      (prepared !== undefined &&
        (prepared.status !== "prepared" ||
          prepared.logicalId !== approved.logicalId ||
          !prepared.preparedPayment))
    )
      throw new Error("Private batch approval context changed");
    const approvedJson = JSON.stringify({
      account: approved.account,
      outputs: approved.outputs.map((output) => ({
        recipient: output.recipient,
        amountSompi: output.amountSompi,
        memoHex: output.memoHex,
      })),
      maxFeeSompi: approved.maxFeeSompi,
    });
    const approvedGenesis = approved.genesis;
    const preparedSnapshot = prepared ? structuredClone(prepared) : undefined;
    const preparedJson = preparedSnapshot
      ? JSON.stringify(preparedSnapshot.preparedPayment)
      : undefined;
    const aborted = new Promise<never>((_, reject) => {
      abortWait = reject;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    await Promise.race([loadPinnedModule(), aborted]);
    if (closed || signal.aborted)
      throw new Error("Private batch account request aborted");
    native = new PrivateAccountSigner(
      privateSeed,
      "mainnet",
      approvedGenesis,
      approvedJson,
    );
    privateSeed.fill(0);
    if (
      native.approved_account() !== selectedAddress0 ||
      closed ||
      signal.aborted
    )
      throw new Error("Private batch approved account changed");
    const current = () => {
      if (closed || signal.aborted || !native)
        throw new Error("Private batch signer is closed");
      return native;
    };
    return {
      sign: async () => {
        if (!preparedJson || !preparedSnapshot)
          throw new Error(
            "Private batch recovery cannot sign without preparation",
          );
        return exactSignatures(
          JSON.parse(current().sign_prepared_v3(preparedJson)),
          preparedSnapshot,
        );
      },
      exportTicket: async () => current().export_signed_v3_ticket(),
      importTicket: async (ticket) => {
        if (preparedJson)
          throw new Error(
            "Private batch signing handle cannot import a ticket",
          );
        current().import_signed_v3_ticket(ticket);
      },
      verifyFinalized: async (signed: ZKasSignedBytes) => {
        if (
          !signed ||
          !/^[0-9a-f]+$/.test(signed.transactionHex) ||
          !/^[0-9a-f]{64}$/.test(signed.txid) ||
          !/^[0-9a-f]{64}$/.test(signed.sha256)
        )
          throw new Error("Invalid finalized private batch response");
        const verified: ZKasSignedBytes = JSON.parse(
          current().verify_finalized_v3(signed.transactionHex),
        );
        if (
          verified.transactionHex !== signed.transactionHex ||
          verified.txid !== signed.txid ||
          verified.sha256 !== signed.sha256
        )
          throw new Error(
            "Finalized private batch response differs from signed bytes",
          );
      },
      close,
    };
  } catch {
    close();
    throw new Error("Private batch signer rejected");
  } finally {
    privateSeed.fill(0);
  }
}
