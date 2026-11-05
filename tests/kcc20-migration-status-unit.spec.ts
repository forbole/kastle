import { test, expect } from "@playwright/test";
import {
  MIGRATION_PENDING_TTL_MS,
  fetchMigrationStatus,
  parseMigrationStatus,
  parsePendingMigration,
  resolvePendingMigration,
  type MigrationStatusResult,
  type PendingMigration,
} from "../lib/kcc20/migration-status";

const TX = "ab".repeat(32);
const PAYOUT = "CD".repeat(32);
const NOW = 1_800_000_000_000;
const ENTRY: PendingMigration = {
  tick: "NACHO",
  address: "kaspa:qtest",
  network: "mainnet",
  openedAt: NOW - 60_000,
};

const answer = (r: MigrationStatusResult) => async () => r;

test.describe("parseMigrationStatus", () => {
  test("404 is not detected, other non-200 is malformed", () => {
    expect(parseMigrationStatus(404, null)).toEqual({ kind: "not_detected" });
    expect(parseMigrationStatus(500, null)).toEqual({ kind: "malformed" });
  });

  test("completed needs a confirmed payout with a well-formed txid", () => {
    expect(
      parseMigrationStatus(200, {
        status: "completed",
        payout: { stage: "confirmed", txId: PAYOUT },
      }),
    ).toEqual({ kind: "completed", payoutTxId: PAYOUT.toLowerCase() });
    expect(
      parseMigrationStatus(200, {
        status: "completed",
        payout: { stage: "broadcast", txId: PAYOUT },
      }),
    ).toEqual({ kind: "pending", raw: "completed" });
  });

  test("only an explicit failed fails; unknown stays pending", () => {
    expect(parseMigrationStatus(200, { status: "failed" }).kind).toBe("failed");
    expect(parseMigrationStatus(200, { status: "weird" })).toEqual({
      kind: "pending",
      raw: "weird",
    });
    expect(parseMigrationStatus(200, { nope: 1 })).toEqual({
      kind: "malformed",
    });
  });
});

test.describe("fetchMigrationStatus", () => {
  test("asks {base}/{txid} and maps a 404 to not detected", async () => {
    const realFetch = globalThis.fetch;
    let asked = "";
    globalThis.fetch = (async (url: string) => {
      asked = url;
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    try {
      const r = await fetchMigrationStatus(TX.toUpperCase(), "https://api.x");
      expect(r).toEqual({ kind: "not_detected" });
      expect(asked).toBe(`https://api.x/${TX}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a bad txid is never sent", async () => {
    expect(await fetchMigrationStatus("xyz", "https://api.x")).toEqual({
      kind: "malformed",
    });
  });
});

test.describe("parsePendingMigration", () => {
  test("rejects partial entries and drops a bad txid", () => {
    expect(parsePendingMigration({ tick: "NACHO" })).toBeUndefined();
    expect(parsePendingMigration({ ...ENTRY, revealTxId: "zz" })).toEqual(
      ENTRY,
    );
  });
});

test.describe("resolvePendingMigration", () => {
  test("without a txid it is pending and unconfirmed, nothing fetched", async () => {
    let called = false;
    const r = await resolvePendingMigration(ENTRY, NOW, async () => {
      called = true;
      return { kind: "not_detected" };
    });
    expect(called).toBe(false);
    expect(r).toEqual({
      entry: ENTRY,
      status: { kind: "pending", tick: "NACHO", unconfirmed: true },
    });
  });

  test("expires after the mobile timeout", async () => {
    const old = { ...ENTRY, openedAt: NOW - MIGRATION_PENDING_TTL_MS };
    expect(await resolvePendingMigration(old, NOW)).toEqual({
      entry: undefined,
      status: undefined,
    });
  });

  test("a confirmed payout clears and shows nothing", async () => {
    const r = await resolvePendingMigration(
      { ...ENTRY, revealTxId: TX },
      NOW,
      answer({ kind: "completed", payoutTxId: TX }),
    );
    expect(r).toEqual({ entry: undefined, status: undefined });
  });

  test("failed is kept and shown as failed", async () => {
    const r = await resolvePendingMigration(
      { ...ENTRY, revealTxId: TX },
      NOW,
      answer({ kind: "failed", raw: "failed" }),
    );
    expect(r.status).toEqual({ kind: "failed", tick: "NACHO" });
    expect(r.entry?.revealTxId).toBe(TX);
  });

  test("a transport error or 404 is unconfirmed, never success", async () => {
    for (const res of [
      { kind: "transport_error", error: new Error("x") },
      { kind: "not_detected" },
      { kind: "malformed" },
    ] as MigrationStatusResult[]) {
      const r = await resolvePendingMigration(
        { ...ENTRY, revealTxId: TX },
        NOW,
        answer(res),
      );
      expect(r.status).toEqual({
        kind: "pending",
        tick: "NACHO",
        unconfirmed: true,
      });
    }
  });

  test("held is pending with an answer", async () => {
    const r = await resolvePendingMigration(
      { ...ENTRY, revealTxId: TX },
      NOW,
      answer({ kind: "held" }),
    );
    expect(r.status).toEqual({
      kind: "pending",
      tick: "NACHO",
      unconfirmed: false,
    });
  });
});
