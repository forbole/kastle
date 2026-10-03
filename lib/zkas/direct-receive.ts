import { ExtensionService } from "@/lib/service/extension-service";
import { zkasKeyService } from "./key-service";
import { DirectBirthStore } from "./direct-birth";
import { DirectPinStore, DIRECT_PINS_KEY } from "./direct-pins";
import {
  decodeNativeDirectView,
  witnessDirectBirth,
  witnessReviewedCursor,
} from "./direct-receive-codec";
import { HistoryGrantStore, type HistoryGrantContext } from "./history-grant";
import { HISTORY_GRANTS_KEY } from "./history-grant";
import { DaemonBearerStore } from "./daemon-bearer";
import { FixedHistoryClient } from "./private-history-client";
import { FixedHistoryIndexClient } from "./private-history-index-client";
import {
  ZKAS_MAINNET_GENESIS,
  historyIndexHostPattern,
} from "./history-config";
import { hasZKasConnection, zkasConnectionStore } from "./connection";

const COLLECTOR_RAW =
  "b676d61cabef82d1837ffe0f0c69a2002bedb7bd371c1c0b6654dffd2618070be9dfe22640c6c399b2ac22";
const ID = /^[0-9a-f]{64}$/;
const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
const hex = (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");

type Actor = Awaited<
  ReturnType<typeof zkasKeyService.openPrivateMessagingSession>
>;
type Profile = Awaited<
  ReturnType<typeof zkasKeyService.publicMessagingProfile>
>;
export type ScopedDirectView = {
  protocolId: "matjam-onchain-v3";
  accountAddress: string;
  history: "session-from-birth" | "unknown" | "gap";
  invitations: Array<{
    inviterId: string;
    actionId: string;
    publicCard: string;
    note: string;
    status: "pending";
  }>;
  contacts: Array<{
    peerId: string;
    publicCard: string;
    status: "request" | "accepted" | "rejected";
  }>;
  threads: Array<{
    peerId: string;
    messages: Array<{
      actionId: string;
      text: string;
      direction: "in" | "out";
    }>;
  }>;
};

type Lease = {
  actor: Actor;
  context: HistoryGrantContext;
  revision: string;
  origin: string;
  connectionGeneration: bigint;
  grantSession: number;
  assertImmediate(): void;
  close(): void;
  assertBase(): Promise<void>;
  assertCurrent(): Promise<void>;
};

async function privateLease(origin: string, profile: Profile): Promise<Lease> {
  const actor = await zkasKeyService.openPrivateMessagingSession();
  try {
    const keyring = ExtensionService.getInstance().getKeyring();
    const grantSession = keyring.getSessionVersion();
    const grantGeneration = keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
    const pinGeneration = keyring.getMutationGeneration(DIRECT_PINS_KEY);
    const connectionGeneration = zkasConnectionStore.getGeneration();
    if (
      actor.address !== profile.accountAddress ||
      hex(actor.publicCard()) !== profile.publicCard ||
      !actor.daemonUrl ||
      !actor.indexUrl
    )
      throw new Error("Private direct source unavailable");
    const connectedAccount = { ...actor.selection, address: actor.address };
    const grantAccount = {
      walletId: actor.selection.walletId,
      accountIndex: actor.selection.accountIndex,
      address0: actor.address,
      network: "mainnet" as const,
      genesis: ZKAS_MAINNET_GENESIS,
    };
    const assertBase = async () => {
      if (
        keyring.getSessionVersion() !== grantSession ||
        keyring.getMutationGeneration(DIRECT_PINS_KEY) !== pinGeneration ||
        keyring.isPrivateWalletWorkPending() ||
        zkasConnectionStore.getGeneration() !== connectionGeneration
      )
        throw new Error("Private direct connection changed");
      await actor.assertCurrent();
      const connections = await zkasConnectionStore.list();
      if (
        zkasConnectionStore.getGeneration() !== connectionGeneration ||
        !hasZKasConnection(connections, origin, connectedAccount)
      )
        throw new Error("Private direct connection changed");
      await actor.assertCurrent();
    };
    await assertBase();
    const grants = await new HistoryGrantStore(keyring).listForAccount(
      grantAccount,
      assertBase,
    );
    const grant = grants.find(
      (row) =>
        row.audience.kind === "website" &&
        row.audience.origin === origin &&
        row.daemonUrl === actor.daemonUrl &&
        row.indexUrl === actor.indexUrl &&
        row.address0 === actor.address &&
        row.genesis === ZKAS_MAINNET_GENESIS,
    );
    if (!grant) throw new Error("Approve direct-chat history in Kastle first");
    const context: HistoryGrantContext = {
      audience: { kind: "website", origin },
      walletId: actor.selection.walletId,
      accountIndex: actor.selection.accountIndex,
      address0: actor.address,
      network: "mainnet",
      genesis: ZKAS_MAINNET_GENESIS,
      daemonUrl: actor.daemonUrl,
      indexUrl: actor.indexUrl,
    };
    const assertCurrent = async () => {
      await assertBase();
      if (
        !(await new HistoryGrantStore(keyring).active(
          context,
          grant.revision,
          grantSession,
          assertBase,
        ))
      )
        throw new Error("Direct-chat history approval changed");
      await assertBase();
    };
    await assertCurrent();
    const assertImmediate = () => {
      if (
        !keyring.isUnlocked() ||
        keyring.isPrivateWalletWorkPending() ||
        keyring.getSessionVersion() !== grantSession ||
        keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== grantGeneration ||
        keyring.getMutationGeneration(DIRECT_PINS_KEY) !== pinGeneration ||
        zkasConnectionStore.getGeneration() !== connectionGeneration
      )
        throw new Error("Private direct lease changed");
      // Synchronous private actor closure/selection fence.
      actor.publicCard();
    };
    const unsubscribe = keyring.subscribeKeyMutation(HISTORY_GRANTS_KEY, () =>
      actor.close(),
    );
    const unsubscribePins = keyring.subscribeKeyMutation(DIRECT_PINS_KEY, () =>
      actor.close(),
    );
    return {
      actor,
      context,
      revision: grant.revision,
      origin,
      connectionGeneration,
      grantSession,
      assertBase,
      assertCurrent,
      assertImmediate,
      close: () => {
        unsubscribe();
        unsubscribePins();
        actor.close();
      },
    };
  } catch (error) {
    actor.close();
    throw error;
  }
}

function toView(
  profile: Profile,
  decoded: ReturnType<typeof decodeNativeDirectView>,
): ScopedDirectView {
  if (
    decoded.messages.length > 128 ||
    decoded.contacts.length > 64 ||
    decoded.invitations.length > 32
  )
    throw new Error("Direct-chat view exceeds website limit");
  const threads = new Map<string, ScopedDirectView["threads"][number]>();
  for (const item of decoded.messages) {
    if (
      item.senderId !== profile.peerId &&
      item.senderId !== item.counterpartId
    )
      throw new Error("Invalid direct-chat counterpart");
    let thread = threads.get(item.counterpartId);
    if (!thread) {
      if (threads.size >= 32)
        throw new Error("Direct-chat view exceeds website limit");
      thread = { peerId: item.counterpartId, messages: [] };
      threads.set(item.counterpartId, thread);
    }
    thread.messages.push({
      actionId: item.actionId,
      text: item.text,
      direction: item.senderId === profile.peerId ? "out" : "in",
    });
  }
  return {
    protocolId: "matjam-onchain-v3",
    accountAddress: profile.accountAddress,
    history: "session-from-birth",
    invitations: decoded.invitations,
    contacts: decoded.contacts,
    threads: [...threads.values()],
  };
}

function notReady(
  profile: Profile,
  history: "unknown" | "gap",
): ScopedDirectView {
  return {
    protocolId: "matjam-onchain-v3",
    accountAddress: profile.accountAddress,
    history,
    invitations: [],
    contacts: [],
    threads: [],
  };
}

/** One private actor for the currently granted website; no page-owned cursor or key. */
export class DirectReceiveRegistry {
  private entry?: Lease & { sourceGeneration: bigint };
  private tail: Promise<void> = Promise.resolve();

  close(): void {
    this.entry?.close();
    this.entry = undefined;
  }

  /** Later action adapter: witness its retained review stamp without retargeting it. */
  async witnessRetainedReview(
    origin: string,
    reviewedHash: string,
    reviewedDaa: bigint,
    reviewedGeneration: bigint,
  ): Promise<void> {
    const entry = this.entry;
    if (
      !entry ||
      entry.origin !== origin ||
      entry.sourceGeneration !== reviewedGeneration ||
      !ID.test(reviewedHash) ||
      reviewedDaa < 0n
    )
      throw new Error("Direct-chat review context changed");
    await entry.assertCurrent();
    const keyring = ExtensionService.getInstance().getKeyring();
    const daemon = new FixedHistoryClient({
      lease: {
        daemonUrl: entry.context.daemonUrl,
        assertCurrent: entry.assertCurrent,
        assertHostPermission: async () => {
          if (
            !(await browser.permissions.contains({
              origins: [historyIndexHostPattern(entry.context.daemonUrl)],
            }))
          )
            throw new Error("Configured direct-chat host unavailable");
        },
        readBearer: () =>
          new DaemonBearerStore(keyring).withBearer(
            entry.context.daemonUrl,
            entry.assertCurrent,
            async (bearer) => bearer,
          ),
      },
    });
    const raw = await daemon.getRawPage(reviewedHash, 1);
    await entry.assertCurrent();
    witnessReviewedCursor(
      raw,
      reviewedHash,
      reviewedDaa,
      reviewedGeneration,
      ZKAS_MAINNET_GENESIS,
    );
    entry.assertImmediate();
  }

  async read(
    origin: string,
    profile: Profile,
  ): Promise<{
    view: ScopedDirectView;
    assertCurrent(): Promise<void>;
    assertImmediate(): void;
  }> {
    const run = this.tail.then(() => this.readOne(origin, profile));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readOne(origin: string, profile: Profile) {
    this.close(); // Replay from the immutable birth; old plaintext/handles never cross requests.
    const lease = await privateLease(origin, profile);
    const { actor, context } = lease;
    const keyring = ExtensionService.getInstance().getKeyring();
    const host = async (url: string) => {
      await lease.assertCurrent();
      if (
        !(await browser.permissions.contains({
          origins: [historyIndexHostPattern(url)],
        }))
      )
        throw new Error(
          "Allow the configured direct-chat host in Kastle first",
        );
      await lease.assertCurrent();
    };
    let index: FixedHistoryIndexClient | undefined;
    try {
      index = new FixedHistoryIndexClient({
        lease: {
          indexUrl: context.indexUrl,
          assertCurrent: lease.assertCurrent,
          assertHostPermission: () => host(context.indexUrl),
        },
      });
      const daemon = new FixedHistoryClient({
        lease: {
          daemonUrl: context.daemonUrl,
          assertCurrent: lease.assertCurrent,
          assertHostPermission: () => host(context.daemonUrl),
          readBearer: () =>
            new DaemonBearerStore(keyring).withBearer(
              context.daemonUrl,
              lease.assertCurrent,
              async (bearer) => bearer,
            ),
        },
      });
      const births = new DirectBirthStore(keyring);
      let birth = await births.read(context, lease.assertCurrent);
      const stableWitness = async (after: string) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const raw = await daemon.getRawPage(after, 1);
          await lease.assertCurrent();
          try {
            return witnessDirectBirth(raw, after, 1, ZKAS_MAINNET_GENESIS);
          } catch (error) {
            if (
              attempt === 2 ||
              !(error instanceof Error) ||
              error.message !== "Selected history tip moved"
            )
              throw error;
          }
        }
        throw new Error("Selected history tip unavailable");
      };
      if (!birth) {
        const hint = await index.getCursorHint();
        if (hint.genesis !== ZKAS_MAINNET_GENESIS || !ID.test(hint.cursor))
          throw new Error("Configured direct-chat index network changed");
        const witness = await stableWitness(hint.cursor);
        await lease.assertCurrent();
        birth = await births.enroll(context, witness, lease.assertCurrent);
      }
      // The old immutable birth hash must still be selected on today's channel.
      const current = await stableWitness(birth.birthHash);
      await lease.assertCurrent();
      if (
        current.daa < BigInt(birth.birthDaa) ||
        current.blue < BigInt(birth.birthBlue)
      )
        throw new Error("Direct-chat birth no longer selected");
      actor.directSessionStart(
        "mainnet",
        context.daemonUrl,
        bytes(birth.sessionId),
        bytes(birth.birthHash),
        BigInt(birth.birthDaa),
        BigInt(birth.birthBlue),
        current.sourceGeneration,
      );
      const pins = await new DirectPinStore(keyring).read(
        context,
        birth,
        lease.assertCurrent,
      );
      const pinnedCards = new Uint8Array(pins.length * 184);
      pins.forEach((card, index) => pinnedCards.set(card, index * 184));
      await lease.assertCurrent();
      actor.directConfigure(bytes(COLLECTOR_RAW), pinnedCards);
      // Limit the prospective session window. A longer gap remains explicit.
      let status = actor.directReceiveStatus();
      let bodies = 0;
      for (let pages = 0; pages < 128 && status === 0; pages++) {
        const cursor = actor.directNextRequest(32);
        if (!ID.test(cursor)) throw new Error("Invalid native direct cursor");
        const page = await daemon.getRawPage(cursor, 32);
        await lease.assertCurrent();
        actor.directAcceptPage(page);
        let next = actor.directNextBodyRequest();
        while (next !== undefined) {
          if (!ID.test(next) || ++bodies > 16_384)
            throw new Error("Direct-chat body capacity exceeded");
          const body = await index.getRawTransaction(next);
          await lease.assertCurrent();
          actor.directAcceptBody(body);
          next = actor.directNextBodyRequest();
        }
        status = actor.directReceiveStatus();
      }
      await lease.assertCurrent();
      this.entry = { ...lease, sourceGeneration: current.sourceGeneration };
      let view: ScopedDirectView;
      if (status === 1) {
        const decoded = decodeNativeDirectView(actor.directReceiveSnapshot());
        if (
          decoded.sessionId !== birth.sessionId ||
          decoded.birthHash !== birth.birthHash ||
          decoded.birthDaa !== BigInt(birth.birthDaa) ||
          decoded.sourceGeneration !== current.sourceGeneration
        )
          throw new Error("Direct-chat source changed");
        view = toView(profile, decoded);
      } else {
        view = notReady(profile, status === 2 ? "unknown" : "gap");
      }
      return {
        view,
        assertCurrent: lease.assertCurrent,
        assertImmediate: lease.assertImmediate,
      };
    } catch (error) {
      this.close();
      lease.close();
      throw error;
    } finally {
      index?.close();
    }
  }
}

export const directReceiveRegistry = new DirectReceiveRegistry();
