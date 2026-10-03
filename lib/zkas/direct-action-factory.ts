import type {
  NativeDirectReview,
  NativeDirectSealed,
} from "./direct-action-codec";
import { ZKasBatchClient } from "./batch-client";
import { ZKasBatchPayment } from "./batch-payment";
import {
  getZKasBatchJournal,
  type DirectActionApproval,
  type ZKasBatchIntent,
} from "./batch-journal";
import { zkasKeyService } from "./key-service";
import { DirectReceiveRegistry, directReceiveRegistry } from "./direct-receive";
import { DirectPinStore, DIRECT_PINS_KEY } from "./direct-pins";
import { HISTORY_GRANTS_KEY } from "./history-grant";
import { ExtensionService } from "@/lib/service/extension-service";
import { assertBatchOrigin } from "./batch-origin";
import { DaemonBearerStore, DAEMON_BEARERS_KEY } from "./daemon-bearer";
import {
  DEFAULT_ZKAS_DAEMON_ORIGIN,
  historyIndexHostPattern,
  ZKAS_MAINNET_GENESIS,
} from "./history-config";
import { decodeNativeDirectView } from "./direct-receive-codec";
import { withWalletSettingsLock } from "@/lib/wallet-settings-storage";
import { withSettingsLock } from "@/lib/settings-storage";
import {
  WALLET_SETTINGS,
  type WalletSettings,
} from "@/contexts/WalletManagerContext";

export type DirectActionInput =
  | { kind: "invite"; publicCard: string; note: string }
  | {
      kind: "decision";
      inviterId: string;
      invitationActionId: string;
      decision: "accept" | "reject";
      note: string;
    }
  | { kind: "text"; peerId: string; text: string };

export type DirectReviewFacts = {
  kind: NativeDirectReview["kind"];
  actionId: string;
  text: string;
  decision: NativeDirectReview["decision"];
  referenceActionId: string | null;
  ownerPeerId: string;
  recipientPeerId: string;
  recipientCardHex: string;
  accountAddress: string;
  daemonOrigin: string;
  outputs: Array<{
    role: "peer" | "cache" | "archive" | "collector";
    recipient: string;
    amountSompi: string;
  }>;
  explicitTotalSompi: "10000003";
  maxNetworkFeeSompi: "5000000";
  maximumTotalSompi: "15000003";
};

export type DirectInitialReply = {
  actionId: string;
  state: "pending";
  preparation: {
    daemonOrigin: string;
    logicalId: string;
    capability: string;
    expiresAtUnix: number;
  };
};
export type DirectActionState = {
  actionId: string;
  state: "pending" | "unknown" | "confirmed" | "failed";
};

type PreparedReview = {
  facts: DirectReviewFacts;
  assertCurrent(): Promise<void>;
  approve(assertPopupCurrent: () => void): Promise<DirectInitialReply>;
  close(): void;
};
type Backend = {
  prepare(origin: string, input: DirectActionInput): Promise<PreparedReview>;
  complete(origin: string, actionId: string): Promise<DirectActionState>;
  status(origin: string, actionId: string): Promise<DirectActionState>;
  pending(origin: string): Promise<DirectActionState | null>;
  resume(
    origin: string,
    actionId: string,
  ): Promise<DirectInitialReply | DirectActionState>;
};

/** One privileged popup approval at a time; phase flips are synchronous. */
export class DirectActionFactory {
  private starting = false;
  private slot?: {
    approvalId: string;
    origin: string;
    prepared: PreparedReview;
    phase: "reviewing" | "approving" | "pending" | "unknown";
  };

  constructor(private readonly backend: Backend) {}

  async startReview(
    origin: string,
    input: DirectActionInput,
  ): Promise<{ approvalId: string; facts: DirectReviewFacts }> {
    if (this.starting || this.slot)
      throw new Error("A direct action is already pending");
    this.starting = true;
    try {
      const prepared = await this.backend.prepare(
        origin,
        structuredClone(input),
      );
      if (!/^[0-9a-f]{32}$/.test(prepared.facts.actionId)) {
        prepared.close();
        throw new Error("Invalid native direct action ID");
      }
      const approvalId = crypto.randomUUID();
      this.slot = { approvalId, origin, prepared, phase: "reviewing" };
      return { approvalId, facts: structuredClone(prepared.facts) };
    } finally {
      this.starting = false;
    }
  }

  async reviewFacts(
    approvalId: string,
    binding: { assertCurrent(): void },
  ): Promise<DirectReviewFacts> {
    const slot = this.slot;
    if (!slot || slot.approvalId !== approvalId || slot.phase !== "reviewing")
      throw new Error("Direct review is unavailable");
    binding.assertCurrent();
    await slot.prepared.assertCurrent();
    binding.assertCurrent();
    if (this.slot !== slot || slot.phase !== "reviewing")
      throw new Error("Direct review changed");
    return structuredClone(slot.prepared.facts);
  }

  async acceptApproval(
    approvalId: string,
    binding: { assertCurrent(): void },
  ): Promise<DirectInitialReply | DirectActionState> {
    const slot = this.slot;
    if (!slot || slot.approvalId !== approvalId || slot.phase !== "reviewing")
      throw new Error("Direct review is unavailable");
    slot.phase = "approving";
    try {
      binding.assertCurrent();
      await slot.prepared.assertCurrent();
      binding.assertCurrent();
      const result = await slot.prepared.approve(() => binding.assertCurrent());
      if (result.actionId !== slot.prepared.facts.actionId)
        throw new Error("Direct action ID changed after approval");
      slot.phase = "pending";
      return result;
    } catch {
      slot.phase = "unknown";
      return { actionId: slot.prepared.facts.actionId, state: "unknown" };
    } finally {
      slot.prepared.close();
    }
  }

  rejectApproval(approvalId: string): DirectActionState {
    const slot = this.slot;
    if (!slot || slot.approvalId !== approvalId)
      throw new Error("Direct review is unavailable");
    const actionId = slot.prepared.facts.actionId;
    if (slot.phase !== "reviewing") return { actionId, state: "unknown" };
    // No await between phase inspection and discard; acceptance cannot win afterward.
    this.slot = undefined;
    slot.prepared.close();
    return { actionId, state: "failed" };
  }

  private clearConfirmedSlot(
    expectedApprovalId: string | undefined,
    origin: string,
    actionId: string,
    result: DirectActionState,
  ): void {
    const slot = this.slot;
    if (
      slot &&
      slot.approvalId === expectedApprovalId &&
      slot.origin === origin &&
      (slot.phase === "pending" || slot.phase === "unknown") &&
      slot.prepared.facts.actionId === actionId &&
      result.actionId === actionId &&
      result.state === "confirmed"
    )
      this.slot = undefined;
  }

  async complete(origin: string, actionId: string): Promise<DirectActionState> {
    const expectedApprovalId = this.slot?.approvalId;
    const result = await this.backend.complete(origin, actionId);
    this.clearConfirmedSlot(expectedApprovalId, origin, actionId, result);
    return result;
  }

  async status(origin: string, actionId: string): Promise<DirectActionState> {
    const expectedApprovalId = this.slot?.approvalId;
    const result = await this.backend.status(origin, actionId);
    this.clearConfirmedSlot(expectedApprovalId, origin, actionId, result);
    return result;
  }

  async pending(origin: string): Promise<DirectActionState | null> {
    const slot = this.slot;
    if (
      slot?.origin === origin &&
      (slot.phase === "approving" || slot.phase === "unknown")
    ) {
      try {
        await slot.prepared.assertCurrent();
        return {
          actionId: slot.prepared.facts.actionId,
          state: "unknown",
        };
      } catch {
        // The retained actor may have closed after its approved pin was saved.
        // Recheck the selected account and durable original below.
      }
    }
    const pending = await this.backend.pending(origin);
    if (pending?.state === "confirmed") {
      this.clearConfirmedSlot(
        slot?.approvalId,
        origin,
        pending.actionId,
        pending,
      );
      return null;
    }
    return pending;
  }

  async resume(
    origin: string,
    actionId: string,
  ): Promise<DirectInitialReply | DirectActionState> {
    const expectedApprovalId = this.slot?.approvalId;
    const result = await this.backend.resume(origin, actionId);
    this.clearConfirmedSlot(expectedApprovalId, origin, actionId, result);
    return result;
  }
}

/** Ignore only native random IDs and an append-only moving selected head. */
export function sameReviewAuthority(
  left: NativeDirectReview,
  right: NativeDirectReview,
): boolean {
  const stable = (review: NativeDirectReview) =>
    JSON.stringify({
      kind: review.kind,
      ownerPeerId: review.ownerPeerId,
      recipientPeerId: review.recipientPeerId,
      recipientCard: Array.from(review.recipientCard),
      addresses: review.addresses,
      rawAddresses: Object.fromEntries(
        Object.entries(review.rawAddresses).map(([role, address]) => [
          role,
          Array.from(address),
        ]),
      ),
      explicitTotalSompi: review.explicitTotalSompi,
      maxNetworkFeeSompi: review.maxNetworkFeeSompi,
      maximumTotalSompi: review.maximumTotalSompi,
      sourceGeneration: review.sourceGeneration.toString(),
      birthHash: review.birthHash,
      sessionId: review.sessionId,
      referenceActionId: review.referenceActionId,
      decision: review.decision,
      text: review.text,
    });
  return stable(left) === stable(right);
}

// PRODUCTION_BACKEND
const HEX16 = /^[0-9a-f]{32}$/;
const HEX184 = /^[0-9a-f]{368}$/;
const MAX_FEE = "5000000";
const hex = (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
function bytes(value: string, count: number): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length !== 2 * count ||
    !/^[0-9a-f]+$/.test(value)
  )
    throw new Error("Invalid direct action identity");
  return Uint8Array.from(value.match(/../g)!, (pair) =>
    Number.parseInt(pair, 16),
  );
}

type ReviewActor = Awaited<
  ReturnType<typeof zkasKeyService.openPrivateMessagingSession>
>;
function nativeReview(
  actor: ReviewActor,
  input: DirectActionInput,
): NativeDirectReview {
  switch (input.kind) {
    case "invite":
      if (!HEX184.test(input.publicCard))
        throw new Error("Invalid recipient card");
      return actor.directReviewInvite(
        bytes(input.publicCard, 184),
        input.note,
        MAX_FEE,
      );
    case "decision":
      if (!HEX16.test(input.inviterId) || !HEX16.test(input.invitationActionId))
        throw new Error("Invalid direct invitation identity");
      if (input.decision !== "accept" && input.decision !== "reject")
        throw new Error("Invalid direct invitation decision");
      return actor.directReviewDecision(
        bytes(input.inviterId, 16),
        bytes(input.invitationActionId, 16),
        input.decision === "accept" ? 1 : 0,
        input.note,
        MAX_FEE,
      );
    case "text":
      if (!HEX16.test(input.peerId))
        throw new Error("Invalid direct peer identity");
      return actor.directReviewText(
        bytes(input.peerId, 16),
        input.text,
        MAX_FEE,
      );
  }
}

function factsFrom(
  review: NativeDirectReview,
  accountAddress: string,
  daemonOrigin: string,
): DirectReviewFacts {
  if (
    review.maxNetworkFeeSompi !== MAX_FEE ||
    review.explicitTotalSompi !== "10000003" ||
    review.maximumTotalSompi !== "15000003"
  )
    throw new Error("Native direct fee changed");
  return {
    kind: review.kind,
    actionId: review.actionId,
    text: review.text,
    decision: review.decision,
    referenceActionId: review.referenceActionId,
    ownerPeerId: review.ownerPeerId,
    recipientPeerId: review.recipientPeerId,
    recipientCardHex: hex(review.recipientCard),
    accountAddress,
    daemonOrigin,
    outputs: [
      { role: "peer", recipient: review.addresses.peer, amountSompi: "1" },
      { role: "cache", recipient: review.addresses.cache, amountSompi: "1" },
      {
        role: "archive",
        recipient: review.addresses.archive,
        amountSompi: "1",
      },
      {
        role: "collector",
        recipient: review.addresses.collector,
        amountSompi: "10000000",
      },
    ],
    explicitTotalSompi: "10000003",
    maxNetworkFeeSompi: "5000000",
    maximumTotalSompi: "15000003",
  };
}

function intentFrom(
  origin: string,
  account: ReviewActor,
  sealed: NativeDirectSealed,
): ZKasBatchIntent {
  return {
    selection: { ...account.selection },
    account: account.address,
    genesis: ZKAS_MAINNET_GENESIS,
    origin,
    logicalId: sealed.idempotencyKey,
    maxFeeSompi: sealed.maxNetworkFeeSompi,
    outputs: sealed.outputs.map((output) => ({
      recipient: output.recipient,
      amountSompi: output.amountSompi,
      memoHex: hex(output.memo),
    })),
  };
}

function approvalFrom(
  review: NativeDirectReview,
  sealed: NativeDirectSealed,
): DirectActionApproval {
  return {
    version: 1,
    actionId: review.actionId,
    idempotencyKey: sealed.idempotencyKey,
    exactDigest: sealed.exactDigest,
    commitment: sealed.commitment,
    fanoutDigest: sealed.fanoutDigest,
    birthHash: review.birthHash,
    sessionId: review.sessionId,
    sourceGeneration: review.sourceGeneration.toString(),
    ownerPeerId: review.ownerPeerId,
    recipientPeerId: review.recipientPeerId,
    recipientCardHex: hex(sealed.approvedCard),
    kind: review.kind,
    referenceActionId: review.referenceActionId,
    text: review.text,
  };
}

/** Ordinary selection/source writers use these same locks in this order. */
async function withOriginalDirectContext<T>(
  selection: ZKasBatchIntent["selection"],
  address: string,
  daemonOrigin: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withWalletSettingsLock(() =>
    withSettingsLock(async () => {
      await zkasKeyService.checkSelection(selection, daemonOrigin);
      const wallets = await storage.getItem<WalletSettings>(WALLET_SETTINGS);
      const selectedAddress = wallets?.wallets
        .find((wallet) => wallet.id === selection.walletId)
        ?.accounts.find(
          (account) => account.index === selection.accountIndex,
        )?.address;
      if (
        wallets?.selectedWalletId !== selection.walletId ||
        wallets?.selectedAccountIndex !== selection.accountIndex ||
        selectedAddress !== address
      )
        throw new Error("Original direct account changed");
      return operation();
    }),
  );
}

async function openPayment(
  origin: string,
  expected: {
    selection: ZKasBatchIntent["selection"];
    accountAddress: string;
    daemonOrigin: string;
    birthHash: string;
    sessionId: string;
    sourceGeneration?: bigint;
    recipientCardHex?: string;
  },
) {
  const selected = await zkasKeyService.publicAccount();
  if (
    selected.walletId !== expected.selection.walletId ||
    selected.accountIndex !== expected.selection.accountIndex ||
    selected.network !== expected.selection.network ||
    selected.address !== expected.accountAddress
  )
    throw new Error("Selected direct account changed");
  const profile = await zkasKeyService.publicMessagingProfile();
  if (profile.accountAddress !== expected.accountAddress)
    throw new Error("Selected direct account changed");
  const view = await directReceiveRegistry.read(origin, profile);
  if (view.view.history !== "session-from-birth")
    throw new Error("Direct session is not ready from birth");
  const ready = async () => {
    const stamp = await directReceiveRegistry.withRetainedReady(
      origin,
      async (lease) => {
        if (
          lease.actor.address !== expected.accountAddress ||
          lease.context.daemonUrl !== expected.daemonOrigin ||
          lease.birth.birthHash !== expected.birthHash ||
          lease.birth.sessionId !== expected.sessionId ||
          (expected.sourceGeneration !== undefined &&
            lease.sourceGeneration !== expected.sourceGeneration)
        )
          throw new Error("Original direct birth or source changed");
        const native = decodeNativeDirectView(
          lease.actor.directReceiveSnapshot(),
        );
        if (
          native.birthHash !== expected.birthHash ||
          native.sessionId !== expected.sessionId ||
          native.sourceGeneration !== lease.sourceGeneration
        )
          throw new Error("Native direct readiness changed");
        return {
          hash: native.tipHash,
          daa: native.tipDaa,
          generation: native.sourceGeneration,
        };
      },
    );
    await directReceiveRegistry.witnessRetainedReview(
      origin,
      stamp.hash,
      stamp.daa,
      stamp.generation,
    );
  };
  await ready();
  if (expected.recipientCardHex) {
    const pins = await directReceiveRegistry.withRetainedReady(
      origin,
      async (lease) =>
        new DirectPinStore(ExtensionService.getInstance().getKeyring()).read(
          lease.context,
          lease.birth,
          lease.assertCurrent,
        ),
    );
    if (!pins.some((card) => hex(card) === expected.recipientCardHex))
      throw new Error("Original direct peer pin is unavailable");
  }
  const credential = await zkasKeyService.credentials();
  if (
    credential.address !== expected.accountAddress ||
    credential.daemonUrl !== expected.daemonOrigin
  )
    throw new Error("Selected credentialed direct source changed");
  const keyring = ExtensionService.getInstance().getKeyring();
  const bearerGeneration = keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
  const assertBearer = () => {
    if (
      !keyring.isUnlocked() ||
      keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !== bearerGeneration
    )
      throw new Error("Direct daemon pairing changed");
  };
  const fixedFetch: typeof fetch = async (input, init) => {
    view.assertImmediate();
    assertBearer();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const parsed = new URL(url);
    if (
      parsed.origin !== expected.daemonOrigin ||
      !parsed.pathname.startsWith("/api/wallet/")
    )
      throw new Error("Direct daemon route changed");
    if (
      !(await browser.permissions.contains({
        origins: [historyIndexHostPattern(expected.daemonOrigin)],
      }))
    )
      throw new Error("Configured direct daemon host unavailable");
    await view.assertCurrent();
    return new DaemonBearerStore(keyring).withBearer(
      expected.daemonOrigin,
      view.assertCurrent,
      async (bearer) => {
        if (!bearer && expected.daemonOrigin !== DEFAULT_ZKAS_DAEMON_ORIGIN)
          throw new Error("Pair the configured direct daemon first");
        view.assertImmediate();
        assertBearer();
        const headers = new Headers(init?.headers);
        if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
        else headers.delete("Authorization");
        const response = await fetch(url, {
          ...init,
          headers,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        });
        view.assertImmediate();
        assertBearer();
        if (response.redirected || (response.url && response.url !== url))
          throw new Error("Direct daemon redirected");
        return response;
      },
    );
  };
  const client = new ZKasBatchClient({
    baseUrl: expected.daemonOrigin,
    token: credential.walletToken,
    fetch: fixedFetch,
  });
  const journal = await getZKasBatchJournal();
  const payment = new ZKasBatchPayment(
    client,
    journal,
    async (intent) => {
      view.assertImmediate();
      assertBearer();
      await zkasKeyService.checkSelection(
        intent.selection,
        expected.daemonOrigin,
        credential.keyringVersion,
      );
      await view.assertCurrent();
      await ready();
    },
    {
      client,
      openRecoverySigner: (intent) =>
        zkasKeyService.openPrivateBatchSigner(intent),
      assertCurrent: (intent) => {
        view.assertImmediate();
        assertBearer();
        if (
          intent.account !== expected.accountAddress ||
          intent.origin !== origin ||
          intent.genesis !== ZKAS_MAINNET_GENESIS
        )
          throw new Error("Original direct intent changed");
      },
      withTerminalContext: (operation) =>
        withOriginalDirectContext(
          expected.selection,
          expected.accountAddress,
          expected.daemonOrigin,
          async () => {
            view.assertImmediate();
            assertBearer();
            await directReceiveRegistry.withRetainedReady(
              origin,
              async (lease) => {
                if (
                  lease.actor.address !== expected.accountAddress ||
                  lease.context.daemonUrl !== expected.daemonOrigin ||
                  lease.birth.birthHash !== expected.birthHash ||
                  lease.birth.sessionId !== expected.sessionId
                )
                  throw new Error("Original direct birth or source changed");
              },
            );
            view.assertImmediate();
            assertBearer();
            return operation();
          },
        ),
    },
  );
  return { client, journal, payment, ready, profile, view };
}

const productionBackend: Backend = {
  async prepare(origin, input) {
    assertBatchOrigin(origin);
    const selected = await zkasKeyService.publicAccount();
    const selectedDaemon = (await zkasKeyService.credentials()).daemonUrl;
    if (!selectedDaemon) throw new Error("Selected direct source unavailable");
    await withOriginalDirectContext(
      selected,
      selected.address,
      selectedDaemon,
      async () => undefined,
    );
    const journal = await getZKasBatchJournal();
    const unresolved = await journal.unresolvedForAccount(selected);
    if (unresolved) {
      if (
        !unresolved.directApproval ||
        !unresolved.signedTicket ||
        !unresolved.transactionHex ||
        !unresolved.txid ||
        !unresolved.sha256
      )
        throw new Error("An original account action is already pending");
      const original = unresolved.directApproval;
      const opened = await openPayment(unresolved.intent.origin, {
        selection: unresolved.intent.selection,
        accountAddress: unresolved.intent.account,
        daemonOrigin: selectedDaemon,
        birthHash: original.birthHash,
        sessionId: original.sessionId,
        recipientCardHex: original.recipientCardHex,
      });
      if (opened.profile.peerId !== original.ownerPeerId)
        throw new Error("Original direct action owner changed");
      await opened.payment.reconcileAccountAfterFreshSettlement(
        unresolved.intent,
      );
    }
    await journal.assertNoUnresolvedAccountAction(selected);
    const profile = await zkasKeyService.publicMessagingProfile();
    const result = await directReceiveRegistry.read(origin, profile);
    if (result.view.history !== "session-from-birth")
      throw new Error("Direct session is not ready from birth");
    const original = await withOriginalDirectContext(
      selected,
      selected.address,
      selectedDaemon,
      () =>
        directReceiveRegistry.withRetainedReady(origin, async (lease) => {
          if (
            lease.actor.address !== selected.address ||
            lease.context.daemonUrl !== selectedDaemon ||
            lease.actor.selection.walletId !== selected.walletId ||
            lease.actor.selection.accountIndex !== selected.accountIndex ||
            lease.actor.selection.network !== selected.network
          )
            throw new Error("Original direct review context changed");
          return { lease, review: nativeReview(lease.actor, input) };
        }),
    );
    const { review, lease } = original;
    const keyring = ExtensionService.getInstance().getKeyring();
    const pairingGeneration = keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    const grantGeneration = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
    const pinGeneration = keyring.getMutationGeneration(DIRECT_PINS_KEY);
    const reviewedSelection = { ...lease.actor.selection };
    const assertReviewedAuthority = (pinSaved: boolean) => {
      if (
        !keyring.isUnlocked() ||
        keyring.getSessionVersion() !== lease.grantSession ||
        keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !==
          pairingGeneration ||
        keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== grantGeneration ||
        keyring.getMutationGeneration(DIRECT_PINS_KEY) !==
          pinGeneration + (pinSaved ? 1 : 0)
      )
        throw new Error("Reviewed direct wallet authority changed");
    };
    if (
      review.ownerPeerId !== profile.peerId ||
      review.birthHash !== lease.birth.birthHash ||
      review.sessionId !== lease.birth.sessionId ||
      review.sourceGeneration !== lease.sourceGeneration
    )
      throw new Error("Native direct review changed session");
    const facts = factsFrom(
      review,
      profile.accountAddress,
      lease.context.daemonUrl,
    );
    return {
      facts,
      assertCurrent: async () => {
        assertReviewedAuthority(false);
        await directReceiveRegistry.withRetainedReady(
          origin,
          async (current) => {
            if (
              current.actor !== lease.actor ||
              current.birth.birthHash !== review.birthHash ||
              current.birth.sessionId !== review.sessionId ||
              current.sourceGeneration !== review.sourceGeneration
            )
              throw new Error("Original direct review lease changed");
          },
        );
        assertReviewedAuthority(false);
      },
      approve: async (assertPopupCurrent) => {
        assertPopupCurrent();
        assertReviewedAuthority(false);
        const fresh = new DirectReceiveRegistry();
        try {
          const current = await fresh.read(origin, profile);
          if (current.view.history !== "session-from-birth")
            throw new Error("Fresh direct replay is not ready");
          const replay = await fresh.withRetainedReady(origin, async (now) => ({
            review: nativeReview(now.actor, input),
            birth: now.birth,
            sourceGeneration: now.sourceGeneration,
            address: now.actor.address,
            daemon: now.context.daemonUrl,
          }));
          if (
            !sameReviewAuthority(review, replay.review) ||
            replay.birth.birthHash !== lease.birth.birthHash ||
            replay.birth.sessionId !== lease.birth.sessionId ||
            replay.sourceGeneration !== lease.sourceGeneration ||
            replay.address !== profile.accountAddress ||
            replay.daemon !== lease.context.daemonUrl
          )
            throw new Error("Fresh direct replay changed approved effects");
          assertReviewedAuthority(false);
        } finally {
          fresh.close();
        }
        assertPopupCurrent();
        assertReviewedAuthority(false);
        await directReceiveRegistry.witnessRetainedReview(
          origin,
          review.selectedReviewTipHash,
          review.selectedReviewTipDaa,
          review.sourceGeneration,
        );
        assertPopupCurrent();
        assertReviewedAuthority(false);
        await (
          await getZKasBatchJournal()
        ).assertNoUnresolvedAccountAction(reviewedSelection);
        assertReviewedAuthority(false);
        const sealed = await directReceiveRegistry.withRetainedReady(
          origin,
          async (current) => {
            if (current.actor !== lease.actor)
              throw new Error("Original direct review actor changed");
            assertPopupCurrent();
            assertReviewedAuthority(false);
            return current.actor.directApproveAndSeal(review, {
              hash: review.selectedReviewTipHash,
              daa: review.selectedReviewTipDaa,
              sourceGeneration: review.sourceGeneration,
            });
          },
        );
        assertReviewedAuthority(false);
        if (
          sealed.actionId !== facts.actionId ||
          hex(sealed.approvedCard) !== facts.recipientCardHex ||
          sealed.explicitTotalSompi !== facts.explicitTotalSompi ||
          sealed.maxNetworkFeeSompi !== facts.maxNetworkFeeSompi ||
          sealed.maximumTotalSompi !== facts.maximumTotalSompi ||
          sealed.outputs.length !== facts.outputs.length ||
          sealed.outputs.some(
            (output, index) =>
              output.role !== facts.outputs[index].role ||
              output.recipient !== facts.outputs[index].recipient ||
              output.amountSompi !== facts.outputs[index].amountSompi,
          )
        )
          throw new Error("Sealed direct outputs changed popup facts");
        // Native seal is cached before pin storage closes the retained actor.
        const intent = intentFrom(origin, lease.actor, sealed);
        const approval = approvalFrom(review, sealed);
        assertPopupCurrent();
        await new DirectPinStore(
          ExtensionService.getInstance().getKeyring(),
        ).recordNativeApproved(
          lease.context,
          lease.birth,
          {
            recipientCard: Uint8Array.from(sealed.approvedCard),
            recipientPeerId: bytes(review.recipientPeerId, 16),
            birthHash: bytes(review.birthHash, 32),
            sessionId: bytes(review.sessionId, 16),
            sourceGeneration: review.sourceGeneration,
          },
          lease.sourceGeneration,
          lease.assertCurrent,
        );
        assertReviewedAuthority(true);
        directReceiveRegistry.close();
        const opened = await openPayment(origin, {
          selection: intent.selection,
          accountAddress: profile.accountAddress,
          daemonOrigin: lease.context.daemonUrl,
          birthHash: review.birthHash,
          sessionId: review.sessionId,
          sourceGeneration: review.sourceGeneration,
        });
        assertReviewedAuthority(true);
        await directReceiveRegistry.withRetainedReady(
          origin,
          async (current) => {
            if (
              current.revision !== lease.revision ||
              current.connectionGeneration !== lease.connectionGeneration ||
              current.grantSession !== lease.grantSession ||
              current.sourceGeneration !== lease.sourceGeneration ||
              current.context.daemonUrl !== lease.context.daemonUrl ||
              current.context.indexUrl !== lease.context.indexUrl ||
              current.birth.birthHash !== lease.birth.birthHash ||
              current.birth.sessionId !== lease.birth.sessionId ||
              current.actor.address !== profile.accountAddress ||
              current.actor.selection.walletId !== reviewedSelection.walletId ||
              current.actor.selection.accountIndex !==
                reviewedSelection.accountIndex ||
              current.actor.selection.network !== reviewedSelection.network
            )
              throw new Error("Reviewed direct source or grant changed");
          },
        );
        assertReviewedAuthority(true);
        assertPopupCurrent();
        const prior = await opened.journal.hasReservation(intent.selection);
        assertReviewedAuthority(true);
        assertPopupCurrent();
        const grant = prior
          ? await opened.payment.beginDirectAfterFreshSettlement(
              intent,
              approval,
            )
          : await opened.payment.beginDirectFirstUse(
              intent,
              approval,
              opened.ready,
            );
        assertReviewedAuthority(true);
        assertPopupCurrent();
        return {
          actionId: review.actionId,
          state: "pending" as const,
          preparation: {
            daemonOrigin: lease.context.daemonUrl,
            logicalId: grant.logicalId,
            capability: grant.capability,
            expiresAtUnix: grant.expiresAtUnix,
          },
        };
      },
      close: () => directReceiveRegistry.close(),
    };
  },

  async pending(origin) {
    assertBatchOrigin(origin);
    const selected = await zkasKeyService.publicAccount();
    const journal = await getZKasBatchJournal();
    const record = await journal.pendingDirectFor(origin, selected);
    if (!record?.directApproval) return null;
    if (record.intent.account !== selected.address)
      throw new Error("Original direct action account changed");
    const original = record.directApproval;
    const opened = await openPayment(origin, {
      selection: record.intent.selection,
      accountAddress: record.intent.account,
      daemonOrigin: (await zkasKeyService.credentials()).daemonUrl ?? "",
      birthHash: original.birthHash,
      sessionId: original.sessionId,
      recipientCardHex: original.recipientCardHex,
    });
    if (opened.profile.peerId !== original.ownerPeerId)
      throw new Error("Original direct action owner changed");
    if (record.txid && record.sha256) {
      const observed = await opened.client.status(record.intent);
      if (observed.txid !== record.txid || observed.sha256 !== record.sha256)
        throw new Error("Original signed direct status changed");
      if (observed.status === "settled")
        return { actionId: original.actionId, state: "confirmed" };
      if (observed.status === "conflicted")
        return { actionId: original.actionId, state: "unknown" };
    }
    return {
      actionId: original.actionId,
      state: record.status === "preparing" ? "pending" : "unknown",
    };
  },

  async resume(origin, actionId) {
    assertBatchOrigin(origin);
    const journal = await getZKasBatchJournal();
    const record = await journal.findDirectAction(origin, actionId);
    if (!record?.directApproval) return { actionId, state: "unknown" };
    if (record.status !== "preparing") return this.status(origin, actionId);
    // The original prepared session or signed ticket is durable. A restarted
    // worker must finish that same action; a status-only reply can strand it.
    if (record.directPrepared || record.signedTicket)
      return this.complete(origin, actionId);
    const original = record.directApproval;
    const opened = await openPayment(origin, {
      selection: record.intent.selection,
      accountAddress: record.intent.account,
      daemonOrigin: (await zkasKeyService.credentials()).daemonUrl ?? "",
      birthHash: original.birthHash,
      sessionId: original.sessionId,
      recipientCardHex: original.recipientCardHex,
    });
    if (
      opened.profile.accountAddress !== record.intent.account ||
      opened.profile.peerId !== original.ownerPeerId
    )
      throw new Error("Original direct action account changed");
    const grant = await opened.payment.resumeDirectGrant(
      record.intent.logicalId,
      opened.ready,
    );
    return {
      actionId,
      state: "pending",
      preparation: {
        daemonOrigin: opened.client.identity,
        logicalId: grant.logicalId,
        capability: grant.capability,
        expiresAtUnix: grant.expiresAtUnix,
      },
    };
  },

  async complete(origin, actionId) {
    assertBatchOrigin(origin);
    const journal = await getZKasBatchJournal();
    const record = await journal.findDirectAction(origin, actionId);
    if (!record?.directApproval) return { actionId, state: "unknown" };
    const original = record.directApproval;
    const opened = await openPayment(origin, {
      selection: record.intent.selection,
      accountAddress: record.intent.account,
      daemonOrigin: (await zkasKeyService.credentials()).daemonUrl ?? "",
      birthHash: original.birthHash,
      sessionId: original.sessionId,
      recipientCardHex: original.recipientCardHex,
    });
    const result =
      record.status === "preparing"
        ? record.signedTicket
          ? await opened.payment.recover(record.intent, (approved) =>
              zkasKeyService.openPrivateBatchSigner(approved),
            )
          : await opened.payment.completeDirectFromJournal(
              record.intent.logicalId,
              (prepared, approved) =>
                zkasKeyService.openPrivateBatchSigner(approved, prepared),
            )
        : await opened.payment.retryStored(record.intent);
    return {
      actionId,
      state:
        result.status === "settled"
          ? "confirmed"
          : result.status === "conflicted"
            ? "failed"
            : result.status === "unknown"
              ? "unknown"
              : "pending",
    };
  },

  async status(origin, actionId) {
    assertBatchOrigin(origin);
    const record = await (
      await getZKasBatchJournal()
    ).findDirectAction(origin, actionId);
    if (!record?.directApproval) return { actionId, state: "unknown" };
    try {
      const opened = await openPayment(origin, {
        selection: record.intent.selection,
        accountAddress: record.intent.account,
        daemonOrigin: (await zkasKeyService.credentials()).daemonUrl ?? "",
        birthHash: record.directApproval.birthHash,
        sessionId: record.directApproval.sessionId,
        recipientCardHex: record.directApproval.recipientCardHex,
      });
      if (opened.profile.peerId !== record.directApproval.ownerPeerId)
        throw new Error("Original direct action owner changed");
      if (record.status === "settled") return { actionId, state: "confirmed" };
      if (record.status === "conflicted") return { actionId, state: "failed" };
      if (!record.txid || !record.sha256) return { actionId, state: "pending" };
      const observed = await opened.client.status(record.intent);
      if (observed.txid !== record.txid || observed.sha256 !== record.sha256)
        return { actionId, state: "unknown" };
      return {
        actionId,
        state:
          observed.status === "settled"
            ? "confirmed"
            : observed.status === "conflicted"
              ? "failed"
              : observed.status === "unknown"
                ? "unknown"
                : "pending",
      };
    } catch {
      return { actionId, state: "unknown" };
    }
  },
};

export const directActionFactory = new DirectActionFactory(productionBackend);
