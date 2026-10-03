import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  ZKasBatchJournal,
  type ZKasBatchIntent,
} from "@/lib/zkas/batch-journal";
import { ZKasBatchPayment } from "@/lib/zkas/batch-payment";
import type {
  ZKasBatchInventory,
  ZKasPreparedBatch,
} from "@/lib/zkas/batch-client";

const rawFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/zkas-direct-action-flow.json", import.meta.url),
    "utf8",
  ),
);
const peerAddress =
  "zkas:p8vmwuwk2npzsjc4udm4zurtdpd76rwyqwma3j9fdda3lc4yhsp30tcesf54ehq29t66jysxg9mc25s";

const collector =
  "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv";
const memo = "4d4a333a" + "00".repeat(508);
const intent: ZKasBatchIntent = {
  selection: { walletId: "fresh", accountIndex: 0, network: "mainnet" },
  account: "zkas:" + "a".repeat(80),
  genesis: "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
  origin: "https://matjam.mooncake.space",
  logicalId: "1".repeat(64),
  outputs: [
    { recipient: peerAddress, amountSompi: "1", memoHex: memo },
    { recipient: "zkas:" + "c".repeat(80), amountSompi: "1", memoHex: memo },
    { recipient: "zkas:" + "d".repeat(80), amountSompi: "1", memoHex: memo },
    {
      recipient: collector,
      amountSompi: "10000000",
      memoHex: "00".repeat(512),
    },
  ],
  maxFeeSompi: "5000000",
};
const approval = {
  version: 1 as const,
  actionId: "2".repeat(32),
  idempotencyKey: intent.logicalId,
  exactDigest: "3".repeat(64),
  birthHash: "4".repeat(64),
  sessionId: "5".repeat(32),
  sourceGeneration: "7",
  ownerPeerId: "7".repeat(32),
  recipientPeerId: "6".repeat(32),
  recipientCardHex: rawFixture.bobCardHex,
  kind: "invite" as const,
  referenceActionId: null,
  text: "hello",
};

function store() {
  let value: unknown = null;
  return {
    getValue: async <T>() => structuredClone(value) as T | null,
    updateValue: async <T>(
      _key: string,
      update: (current: T | null) => T | Promise<T>,
    ) => {
      value = structuredClone(await update(value as T | null));
    },
  };
}

test("a fresh direct action reserves one encrypted-journal record only after enrollment proof", async () => {
  const persisted = store();
  const journal = new ZKasBatchJournal(persisted, async () => false);
  let proofs = 0;
  await journal.reserveDirectFirstUse(
    intent,
    approval,
    () => undefined,
    async () => {
      proofs++;
    },
  );
  expect(proofs).toBe(1);
  expect(
    (
      await new ZKasBatchJournal(persisted, async () => false).get(
        intent.logicalId,
      )
    )?.directApproval,
  ).toEqual(approval);
  await expect(
    journal.reserveDirectFirstUse(
      { ...intent, logicalId: "8".repeat(64) },
      { ...approval, actionId: "9".repeat(32), idempotencyKey: "8".repeat(64) },
      () => undefined,
      async () => {
        proofs++;
      },
    ),
  ).rejects.toThrow(/unresolved|already|first/i);
  expect(proofs).toBe(1);
});

test("first-use admission remains closed when inventory proof or legacy reservation fails", async () => {
  const persisted = store();
  const journal = new ZKasBatchJournal(persisted, async () => false);
  await expect(
    journal.reserveDirectFirstUse(
      intent,
      approval,
      () => undefined,
      async () => {
        throw new Error("inventory has an unlisted reservation");
      },
    ),
  ).rejects.toThrow(/unlisted/i);
  expect(await journal.get(intent.logicalId)).toBeUndefined();
  const legacy = new ZKasBatchJournal(persisted, async () => true);
  let proved = false;
  await expect(
    legacy.reserveDirectFirstUse(
      intent,
      approval,
      () => undefined,
      async () => {
        proved = true;
      },
    ),
  ).rejects.toThrow(/legacy/i);
  expect(proved).toBe(false);
});

test("malformed native approval or four-output service payment cannot enter the first-use journal", async () => {
  const journal = new ZKasBatchJournal(store(), async () => false);
  let proofs = 0;
  const proof = async () => {
    proofs++;
  };
  await expect(
    journal.reserveDirectFirstUse(
      intent,
      { ...approval, idempotencyKey: "9".repeat(64) },
      () => undefined,
      proof,
    ),
  ).rejects.toThrow(/approval/i);
  await expect(
    journal.reserveDirectFirstUse(
      { ...intent, maxFeeSompi: "5000001" },
      approval,
      () => undefined,
      proof,
    ),
  ).rejects.toThrow(/approval/i);
  await expect(
    journal.reserveDirectFirstUse(
      {
        ...intent,
        outputs: intent.outputs.map((output, index) =>
          index === 3 ? { ...output, memoHex: memo } : output,
        ),
      },
      approval,
      () => undefined,
      proof,
    ),
  ).rejects.toThrow(/approval/i);
  await expect(
    journal.reserveDirectFirstUse(
      {
        ...intent,
        outputs: intent.outputs.map((output, index) =>
          index === 2 ? { ...output, amountSompi: "2" } : output,
        ),
      },
      approval,
      () => undefined,
      proof,
    ),
  ).rejects.toThrow(/approval/i);
  expect(proofs).toBe(0);
  expect(await journal.get(intent.logicalId)).toBeUndefined();
});

function paymentHarness(inventoryOverride?: () => Promise<ZKasBatchInventory>) {
  const events: string[] = [];
  const backing = store();
  const journal = new ZKasBatchJournal(backing, async () => false);
  const daemon: ConstructorParameters<typeof ZKasBatchPayment>[0] = {
    identity: "https://wallet.example.test",
    grant: async (approved: ZKasBatchIntent) => {
      events.push("grant");
      return {
        capability: "a".repeat(64),
        logicalId: approved.logicalId,
        expiresAtUnix: 2_000_000_000,
      };
    },
    prepared: async () => {
      throw new Error("not prepared");
    },
    finalize: async () => {
      throw new Error("not finalized");
    },
    finalizedJournal: async () => {
      throw new Error("not finalized");
    },
    submit: async () => {
      throw new Error("not submitted");
    },
  };
  const empty = async (): Promise<ZKasBatchInventory> => {
    events.push("inventory");
    return {
      inventoryOnly: true,
      epoch: "a".repeat(64),
      entries: [],
      unlistedReservationCount: 0,
    };
  };
  const admission = {
    client: {
      discoverRecords: inventoryOverride ?? empty,
      status: async () => {
        throw new Error("no prior payment");
      },
    },
    openRecoverySigner: async () => {
      throw new Error("no prior ticket");
    },
    assertCurrent: () => {
      events.push("fence");
    },
  };
  const flow = new ZKasBatchPayment(
    daemon,
    journal,
    async () => {
      events.push("selection");
    },
    admission,
  );
  const ready = async () => {
    events.push("ready-from-birth");
  };
  return { events, backing, journal, flow, ready, daemon, admission };
}

test("first-use payment requires two complete empty inventories and ready FromBirth before grant", async () => {
  const h = paymentHarness();
  const result = await h.flow.beginDirectFirstUse(intent, approval, h.ready);
  expect(result.logicalId).toBe(intent.logicalId);
  expect(h.events.filter((event) => event === "inventory")).toHaveLength(2);
  expect(
    h.events.filter((event) => event === "ready-from-birth").length,
  ).toBeGreaterThanOrEqual(2);
  expect(h.events.indexOf("inventory")).toBeLessThan(h.events.indexOf("grant"));
  expect((await h.journal.get(intent.logicalId))?.directApproval).toEqual(
    approval,
  );
});

test("nonempty or unlisted inventory never reserves or grants the first direct action", async () => {
  let walks = 0;
  const h = paymentHarness(async () => {
    walks++;
    return {
      inventoryOnly: true,
      epoch: "b".repeat(64),
      entries: [],
      unlistedReservationCount: walks === 2 ? 1 : 0,
    };
  });
  await expect(
    h.flow.beginDirectFirstUse(intent, approval, h.ready),
  ).rejects.toThrow(/inventory|unlisted/i);
  expect(walks).toBe(2);
  expect(h.events).not.toContain("grant");
  expect(await h.journal.get(intent.logicalId)).toBeUndefined();
});

test("failed first grant resumes the exact original action after worker restart", async () => {
  const h = paymentHarness();
  let grants = 0;
  h.daemon.grant = async (approved) => {
    grants++;
    if (grants === 1) throw new Error("grant reply lost");
    return {
      capability: "a".repeat(64),
      logicalId: approved.logicalId,
      expiresAtUnix: 2_000_000_000,
    };
  };
  await expect(
    h.flow.beginDirectFirstUse(intent, approval, h.ready),
  ).rejects.toThrow(/lost/i);
  const original = await h.journal.get(intent.logicalId);
  expect(original?.directApproval).toEqual(approval);
  const restarted = new ZKasBatchPayment(
    h.daemon,
    new ZKasBatchJournal(h.backing, async () => false),
    async () => undefined,
    h.admission,
  );
  expect(
    (await restarted.resumeDirectGrant(intent.logicalId, h.ready)).logicalId,
  ).toBe(intent.logicalId);
  expect(grants).toBe(2);
  expect(h.events.filter((event) => event === "inventory")).toHaveLength(2);
  expect((await h.journal.get(intent.logicalId))?.directApproval).toEqual(
    approval,
  );
});

test("a newly discovered legacy reservation blocks regrant of the first direct action", async () => {
  const h = paymentHarness();
  await h.flow.beginDirectFirstUse(intent, approval, h.ready);
  const restarted = new ZKasBatchPayment(
    h.daemon,
    new ZKasBatchJournal(h.backing, async () => true),
    async () => undefined,
    h.admission,
  );
  await expect(
    restarted.resumeDirectGrant(intent.logicalId, h.ready),
  ).rejects.toThrow(/legacy/i);
  expect(h.events.filter((event) => event === "grant")).toHaveLength(1);
});

test("a restarted direct completion pins the first prepared session and rejects substitution", async () => {
  const h = paymentHarness();
  await h.flow.beginDirectFirstUse(intent, approval, h.ready);
  const restarted = new ZKasBatchPayment(
    h.daemon,
    new ZKasBatchJournal(h.backing, async () => false),
    async () => undefined,
    h.admission,
  );
  const prepared = {
    status: "prepared" as const,
    logicalId: intent.logicalId,
    session: "7".repeat(48),
    preparedPayment: { checksum: "8".repeat(64) },
  } as unknown as ZKasPreparedBatch;
  h.daemon.prepared = async () => prepared;
  let opened = 0;
  await expect(
    restarted.completeDirectFromJournal(intent.logicalId, async () => {
      opened++;
      throw new Error("signer reached");
    }),
  ).rejects.toThrow(/signer reached/i);
  expect(opened).toBe(1);
  expect((await h.journal.get(intent.logicalId))?.directPrepared).toEqual({
    session: prepared.session,
    checksum: prepared.preparedPayment!.checksum,
  });
  h.daemon.prepared = async () => ({ ...prepared, session: "9".repeat(48) });
  await expect(
    restarted.completeDirectFromJournal(intent.logicalId, async () => {
      opened++;
      throw new Error("substituted signer reached");
    }),
  ).rejects.toThrow(/changed|original/i);
  expect(opened).toBe(1);
});
