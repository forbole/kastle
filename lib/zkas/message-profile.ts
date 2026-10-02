import { ZKAS_MAINNET_GENESIS } from "./history-config";
import {
  initSync,
  PrivateMj3Account,
} from "../../wasm/mj3-wallet/mj3_message_wallet_bindings.js";
import wasmAssetUrl from "../../wasm/mj3-wallet/mj3_message_wallet_bindings_bg.wasm?url";

const PINNED_WASM_SHA256 =
  "3a5d2548e7db335b057489abf13d1e2fdceb22163db7b83488493f7ad476adbf";
const MAX_WASM_BYTES = 4 * 1024 * 1024;
const LOAD_DEADLINE_MS = 10_000;
const GENESIS = Uint8Array.from(
  ZKAS_MAINNET_GENESIS.match(/../g)!.map((byte) => parseInt(byte, 16)),
);

export type PrivateMessagingAccount = {
  publicCard(): Uint8Array;
  signLoginAssertion(
    claim: Uint8Array,
    expectedOrigin: string,
    trustedNowSeconds: bigint,
  ): Uint8Array;
  signCardPublicationAssertion(
    claim: Uint8Array,
    expectedOrigin: string,
    trustedNowSeconds: bigint,
  ): Uint8Array;
  close(): void;
};

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
          reject(new Error("Private messaging module load expired"));
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
          throw new Error("Private messaging module unavailable");
        const length = response.headers.get("content-length");
        if (
          length !== null &&
          (!/^[1-9][0-9]{0,7}$/.test(length) || Number(length) > MAX_WASM_BYTES)
        ) {
          throw new Error("Private messaging module exceeds byte limit");
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_WASM_BYTES)
              throw new Error("Private messaging module exceeds byte limit");
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        if (expired || controller.signal.aborted)
          throw new Error("Private messaging module load expired");
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
          const hex = Array.from(digest, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          if (expired || controller.signal.aborted)
            throw new Error("Private messaging module load expired");
          if (hex !== PINNED_WASM_SHA256)
            throw new Error("Private messaging module pin mismatch");
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

/**
 * This accepts wallet-held account seed bytes only from a privileged caller.
 * The future key-service factory must establish selection, grant, origin and
 * human approval; this loader does not confer those authorities.
 */
export async function createPrivateMessagingAccount(
  seed: Uint8Array,
  selectedAddress0: string,
  signal: AbortSignal,
): Promise<PrivateMessagingAccount> {
  if (!(seed instanceof Uint8Array))
    throw new Error("Invalid private messaging seed buffer");
  if (seed.length !== 32) {
    seed.fill(0);
    throw new Error("Invalid private messaging seed buffer");
  }
  let privateSeed: Uint8Array;
  try {
    privateSeed = Uint8Array.from(seed);
  } finally {
    seed.fill(0);
  }
  let native: PrivateMj3Account | undefined;
  let closed = false;
  let abortWait: ((reason: Error) => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    privateSeed.fill(0);
    signal.removeEventListener("abort", onAbort);
    if (native) {
      try {
        native.close();
      } finally {
        native.free();
        native = undefined;
      }
    }
  };
  const onAbort = () => {
    close();
    abortWait?.(new Error("Private messaging account request aborted"));
  };
  try {
    if (typeof selectedAddress0 !== "string" || !selectedAddress0)
      throw new Error("Invalid private messaging account input");
    if (signal.aborted)
      throw new Error("Private messaging account request aborted");
    const aborted = new Promise<never>((_, reject) => {
      abortWait = reject;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    await Promise.race([loadPinnedModule(), aborted]);
    if (closed || signal.aborted)
      throw new Error("Private messaging account request aborted");
    native = PrivateMj3Account.new_from_canonical_address(
      privateSeed,
      GENESIS,
      selectedAddress0,
    );
    privateSeed.fill(0);
    if (closed || signal.aborted)
      throw new Error("Private messaging account request aborted");
    const current = () => {
      if (closed || signal.aborted || !native)
        throw new Error("Private messaging account is closed");
      return native;
    };
    return {
      publicCard: () => Uint8Array.from(current().public_card()),
      signLoginAssertion: (claim, expectedOrigin, trustedNowSeconds) =>
        Uint8Array.from(
          current().sign_login_assertion(
            claim,
            expectedOrigin,
            trustedNowSeconds,
          ),
        ),
      signCardPublicationAssertion: (
        claim,
        expectedOrigin,
        trustedNowSeconds,
      ) =>
        Uint8Array.from(
          current().sign_card_publication_assertion(
            claim,
            expectedOrigin,
            trustedNowSeconds,
          ),
        ),
      close,
    };
  } catch {
    close();
    throw new Error("Private messaging account rejected");
  } finally {
    privateSeed.fill(0);
  }
}
