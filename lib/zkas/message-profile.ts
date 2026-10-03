import { ZKAS_MAINNET_GENESIS } from "./history-config";
import {
  initSync,
  PrivateMj3Account,
} from "../../wasm/mj3-wallet/mj3_message_wallet_bindings.js";
import wasmAssetUrl from "../../wasm/mj3-wallet/mj3_message_wallet_bindings_bg.wasm?url";
import {
  decodeNativeDirectReview,
  decodeNativeDirectSealed,
  decodeNativeDirectSealedStatus,
  type NativeDirectReview,
  type NativeDirectSealed,
} from "./direct-action-codec";

const PINNED_WASM_SHA256 =
  "8e902ca1bedbf30103a09f5bd74efc60229dcf218d11f17260ca83d3a3227259";
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
  directSessionStart(
    network: string,
    daemon: string,
    sessionId: Uint8Array,
    birthHash: Uint8Array,
    birthDaa: bigint,
    birthBlue: bigint,
    sourceGeneration: bigint,
  ): void;
  directConfigure(collector: Uint8Array, pinnedCardsFlat: Uint8Array): void;
  directRefreshStart(): void;
  directNextRequest(limit: number): string;
  directAcceptPage(raw: Uint8Array): number;
  directNextBodyRequest(): string | undefined;
  directAcceptBody(raw: Uint8Array): number;
  directReceiveStatus(): number;
  directReceiveSnapshot(): Uint8Array;
  directReviewInvite(
    card: Uint8Array,
    note: string,
    maxNetworkFeeSompi: string,
  ): NativeDirectReview;
  directReviewDecision(
    inviterId: Uint8Array,
    invitationActionId: Uint8Array,
    decision: 0 | 1,
    note: string,
    maxNetworkFeeSompi: string,
  ): NativeDirectReview;
  directReviewText(
    peerId: Uint8Array,
    text: string,
    maxNetworkFeeSompi: string,
  ): NativeDirectReview;
  /** Privileged caller must first prove this reviewed selected tip remains selected. */
  directApproveAndSeal(
    review: NativeDirectReview,
    selectedReview: {
      hash: string;
      daa: bigint;
      sourceGeneration: bigint;
    },
  ): NativeDirectSealed;
  directSealedStatus(): ReturnType<
    typeof decodeNativeDirectSealedStatus
  > | null;
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
  let configuredCollector: Uint8Array | undefined;
  let closed = false;
  let abortWait: ((reason: Error) => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    privateSeed.fill(0);
    configuredCollector = undefined;
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
    const collector = () => {
      if (!configuredCollector)
        throw new Error("Direct collector is not configured");
      return configuredCollector;
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
      directSessionStart: (...args) => current().direct_session_start(...args),
      directConfigure: (address, pinnedCardsFlat) => {
        current().direct_receive_configure(address, pinnedCardsFlat);
        configuredCollector = Uint8Array.from(address);
      },
      directRefreshStart: () => current().direct_refresh_start(),
      directNextRequest: (limit) => current().direct_next_request(limit),
      directAcceptPage: (raw) => current().direct_accept_page(raw),
      directNextBodyRequest: () => current().direct_next_body_request(),
      directAcceptBody: (raw) => current().direct_accept_body(raw),
      directReceiveStatus: () => current().direct_receive_status(),
      directReceiveSnapshot: () =>
        Uint8Array.from(current().direct_receive_snapshot()),
      directReviewInvite: (card, note, fee) =>
        decodeNativeDirectReview(
          current().direct_review_invite(card, note, fee),
          collector(),
        ),
      directReviewDecision: (inviter, invitation, decision, note, fee) =>
        decodeNativeDirectReview(
          current().direct_review_decision(
            inviter,
            invitation,
            decision,
            note,
            fee,
          ),
          collector(),
        ),
      directReviewText: (peer, text, fee) =>
        decodeNativeDirectReview(
          current().direct_review_text(peer, text, fee),
          collector(),
        ),
      directApproveAndSeal: (review, selectedReview) => {
        if (
          selectedReview.hash !== review.selectedReviewTipHash ||
          selectedReview.daa !== review.selectedReviewTipDaa ||
          selectedReview.sourceGeneration !== review.sourceGeneration
        )
          throw new Error("Reviewed direct selected tip changed");
        const tip = Uint8Array.from(selectedReview.hash.match(/../g)!, (pair) =>
          parseInt(pair, 16),
        );
        const sealed = current().direct_approve_and_seal(
          Uint8Array.from(review.token),
          tip,
          selectedReview.daa,
          selectedReview.sourceGeneration,
        );
        return decodeNativeDirectSealed(sealed, review);
      },
      directSealedStatus: () => {
        const status = current().direct_sealed_status();
        return status === undefined
          ? null
          : decodeNativeDirectSealedStatus(status);
      },
      close,
    };
  } catch {
    close();
    throw new Error("Private messaging account rejected");
  } finally {
    privateSeed.fill(0);
  }
}
