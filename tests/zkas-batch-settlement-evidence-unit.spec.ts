import { expect, test } from "@playwright/test";
import type {
  ZKasBatchInventory,
  ZKasBatchSendStatus,
} from "@/lib/zkas/batch-client";
import type { ZKasBatchRecord } from "@/lib/zkas/batch-journal";
import { assertFreshSettledBatchEvidence } from "@/lib/zkas/batch-settlement-evidence";

const selection = {
  walletId: "synthetic-wallet",
  accountIndex: 0,
  network: "mainnet" as const,
};
const account = `zkas:${"a".repeat(80)}`;
const genesis = "1".repeat(64);
const daemonIdentity = "https://wallet.example.test";
const logicalId = "2".repeat(64);
const txid = "3".repeat(64);
const bytes = "ab".repeat(100);

async function sha256(value: string): Promise<string> {
  const raw = new Uint8Array(value.length / 2);
  for (let i = 0; i < raw.length; i++)
    raw[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

async function fixture() {
  const digest = await sha256(bytes);
  const ticketValue = "synthetic public ticket";
  const ticketDigest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ticketValue),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const record: ZKasBatchRecord = {
    intent: {
      selection,
      account,
      genesis,
      origin: "https://app.example.test",
      logicalId,
      outputs: [
        {
          recipient: `zkas:${"b".repeat(80)}`,
          amountSompi: "1",
          memoHex: "00".repeat(512),
        },
      ],
      maxFeeSompi: "1000000",
    },
    status: "settled",
    transactionHex: bytes,
    txid,
    sha256: digest,
    signedTicket: {
      value: ticketValue,
      sha256: ticketDigest,
      session: "4".repeat(48),
      daemonIdentity,
      preparedChecksum: "5".repeat(64),
    },
  };
  const inventory = (epoch: string): ZKasBatchInventory => ({
    inventoryOnly: true,
    epoch,
    unlistedReservationCount: 0,
    entries: [
      { logicalId, revision: 1, status: "unknown", txid, sha256: digest },
    ],
  });
  const status: ZKasBatchSendStatus = {
    status: "settled",
    logicalId,
    txid,
    sha256: digest,
  };
  return {
    selection,
    account,
    genesis,
    daemonIdentity,
    records: [record],
    before: inventory("6".repeat(64)),
    statuses: [status],
    after: inventory("7".repeat(64)),
  };
}

test("different complete inventory epochs still support the same fresh settled evidence", async () => {
  const input = await fixture();
  await expect(assertFreshSettledBatchEvidence(input)).resolves.toBeUndefined();
});

test("a locally settled record cannot release on a fresh UNKNOWN status", async () => {
  const input = await fixture();
  input.statuses[0].status = "unknown";
  await expect(assertFreshSettledBatchEvidence(input)).rejects.toThrow(
    /settled/i,
  );
});

test("every retained record needs its own fresh settled response", async () => {
  const input = await fixture();
  const secondId = "8".repeat(64);
  const secondTxid = "9".repeat(64);
  const second = structuredClone(input.records[0]);
  second.intent.logicalId = secondId;
  second.txid = secondTxid;
  input.records.push(second);
  for (const inventory of [input.before, input.after]) {
    inventory.entries.push({
      ...inventory.entries[0],
      logicalId: secondId,
      txid: secondTxid,
    });
  }
  input.statuses.push({
    ...input.statuses[0],
    logicalId: secondId,
    txid: secondTxid,
    status: "included",
  });
  await expect(assertFreshSettledBatchEvidence(input)).rejects.toThrow(
    /settled/i,
  );
  input.statuses[1].status = "settled";
  await expect(assertFreshSettledBatchEvidence(input)).resolves.toBeUndefined();
});

test("both complete walks require zero unlisted and exact immutable bindings", async () => {
  const cases: {
    name: string;
    change: (input: Awaited<ReturnType<typeof fixture>>) => void;
  }[] = [
    {
      name: "before unlisted",
      change: (i) => {
        i.before.unlistedReservationCount = 1;
      },
    },
    {
      name: "after unlisted",
      change: (i) => {
        i.after.unlistedReservationCount = 1;
      },
    },
    {
      name: "missing before",
      change: (i) => {
        i.before.entries = [];
      },
    },
    {
      name: "missing after",
      change: (i) => {
        i.after.entries = [];
      },
    },
    {
      name: "extra before",
      change: (i) => {
        i.before.entries.push({
          ...i.before.entries[0],
          logicalId: "8".repeat(64),
        });
      },
    },
    {
      name: "duplicate after",
      change: (i) => {
        i.after.entries.push({ ...i.after.entries[0] });
      },
    },
    {
      name: "before txid",
      change: (i) => {
        i.before.entries[0].txid = "9".repeat(64);
      },
    },
    {
      name: "after digest",
      change: (i) => {
        i.after.entries[0].sha256 = "9".repeat(64);
      },
    },
  ];
  for (const scenario of cases) {
    const input = await fixture();
    scenario.change(input);
    await expect(
      assertFreshSettledBatchEvidence(input),
      scenario.name,
    ).rejects.toThrow();
  }
});

test("every status must freshly settle the exact retained identity", async () => {
  for (const status of [
    "unknown",
    "mempool",
    "included",
    "conflicted",
    "finalized_unsent",
  ] as const) {
    const input = await fixture();
    input.statuses[0].status = status;
    await expect(
      assertFreshSettledBatchEvidence(input),
      status,
    ).rejects.toThrow();
  }
  for (const field of ["logicalId", "txid", "sha256"] as const) {
    const input = await fixture();
    input.statuses[0][field] = "9".repeat(64);
    await expect(
      assertFreshSettledBatchEvidence(input),
      field,
    ).rejects.toThrow();
  }
  const missing = await fixture();
  missing.statuses = [];
  await expect(assertFreshSettledBatchEvidence(missing)).rejects.toThrow();
  const duplicated = await fixture();
  duplicated.statuses.push({ ...duplicated.statuses[0] });
  await expect(assertFreshSettledBatchEvidence(duplicated)).rejects.toThrow();
});

test("local signed bytes, original ticket and account binding are required", async () => {
  const cases: {
    name: string;
    change: (input: Awaited<ReturnType<typeof fixture>>) => void;
  }[] = [
    {
      name: "changed full bytes",
      change: (i) => {
        i.records[0].transactionHex = "ac".repeat(100);
      },
    },
    {
      name: "missing full bytes",
      change: (i) => {
        delete i.records[0].transactionHex;
      },
    },
    {
      name: "missing ticket",
      change: (i) => {
        delete i.records[0].signedTicket;
      },
    },
    {
      name: "changed original ticket digest",
      change: (i) => {
        i.records[0].signedTicket!.sha256 = "f".repeat(64);
      },
    },
    {
      name: "foreign daemon",
      change: (i) => {
        i.records[0].signedTicket!.daemonIdentity =
          "https://foreign.example.test";
      },
    },
    {
      name: "preparing",
      change: (i) => {
        i.records[0].status = "preparing";
      },
    },
    {
      name: "changed account",
      change: (i) => {
        i.records[0].intent.account = `zkas:${"f".repeat(80)}`;
      },
    },
    {
      name: "changed genesis",
      change: (i) => {
        i.records[0].intent.genesis = "f".repeat(64);
      },
    },
    {
      name: "duplicate local",
      change: (i) => {
        i.records.push(structuredClone(i.records[0]));
      },
    },
    {
      name: "no local enrollment",
      change: (i) => {
        i.records = [];
        i.before.entries = [];
        i.after.entries = [];
        i.statuses = [];
      },
    },
  ];
  for (const scenario of cases) {
    const input = await fixture();
    scenario.change(input);
    await expect(
      assertFreshSettledBatchEvidence(input),
      scenario.name,
    ).rejects.toThrow();
  }
});

test("later caller mutation cannot rewrite a captured evidence snapshot", async () => {
  const input = await fixture();
  const checking = assertFreshSettledBatchEvidence(input);
  input.records[0].transactionHex = "ac".repeat(100);
  input.before.entries[0].txid = "9".repeat(64);
  input.after.unlistedReservationCount = 1;
  input.statuses[0].status = "unknown";
  await expect(checking).resolves.toBeUndefined();
});
