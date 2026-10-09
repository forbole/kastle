import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function loadFactory() {
  const source = readFileSync(
    resolve("lib/zkas/direct-action-factory.ts"),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("export class DirectActionFactory"),
    source.indexOf("// PRODUCTION_BACKEND"),
  );
  const code = await transform(body, {
    loader: "ts",
    format: "iife",
    globalName: "FactoryTest",
    target: "es2022",
  });
  return new Function(
    code.code + "\nreturn FactoryTest.DirectActionFactory;",
  )() as new (backend: unknown) => {
    startReview(
      origin: string,
      input: unknown,
    ): Promise<{
      approvalId: string;
      facts: { actionId: string; text: string };
    }>;
    reviewFacts(
      approvalId: string,
      binding: { assertCurrent(): void },
    ): Promise<{ actionId: string; text: string }>;
    acceptApproval(
      approvalId: string,
      binding: { assertCurrent(): void },
    ): Promise<{ actionId: string; state: string }>;
    rejectApproval(
      approvalId: string,
    ): Promise<{ actionId: string; state: string }>;
    status(
      origin: string,
      actionId: string,
    ): Promise<{ actionId: string; state: string }>;
    pending(
      origin: string,
    ): Promise<{ actionId: string; state: string } | null>;
    resume(
      origin: string,
      actionId: string,
    ): Promise<{ actionId: string; state: string }>;
  };
}

test("a clean rejection is failed, but a started approval can only be unknown", async () => {
  const Factory = await loadFactory();
  let finish!: (value: unknown) => void;
  let sealCalls = 0;
  const backend = {
    prepare: async () => ({
      facts: { actionId: "11".repeat(16), text: "hello" },
      assertCurrent: async () => {},
      approve: async () => {
        sealCalls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      close: () => {},
    }),
  };
  const factory = new Factory(backend);
  const first = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  expect(await factory.rejectApproval(first.approvalId)).toEqual({
    actionId: "11".repeat(16),
    state: "failed",
  });
  const second = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  const approving = factory.acceptApproval(second.approvalId, {
    assertCurrent: () => {},
  });
  await expect.poll(() => sealCalls).toBe(1);
  expect(await factory.rejectApproval(second.approvalId)).toEqual({
    actionId: "11".repeat(16),
    state: "unknown",
  });
  finish({ actionId: "11".repeat(16), state: "pending", preparation: {} });
  expect((await approving).state).toBe("pending");
});

test("only a scoped exact confirmed lookup clears the original pending slot", async () => {
  const Factory = await loadFactory();
  const id = "11".repeat(16);
  let observed: { actionId: string; state: string } | null = null;
  let reviews = 0;
  const factory = new Factory({
    prepare: async () => {
      reviews++;
      return {
        facts: { actionId: id, text: "hello" },
        assertCurrent: async () => {},
        approve: async () => ({
          actionId: id,
          state: "pending",
          preparation: {},
        }),
        close: () => {},
      };
    },
    pending: async () => observed,
  });
  const first = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  await factory.acceptApproval(first.approvalId, { assertCurrent: () => {} });
  expect(await factory.pending("https://messages.example")).toBeNull();
  await expect(
    factory.startReview("https://messages.example", {
      kind: "text",
      text: "next",
    }),
  ).rejects.toThrow(/already pending/i);
  observed = { actionId: id, state: "unknown" };
  expect(await factory.pending("https://messages.example")).toEqual(observed);
  await expect(
    factory.startReview("https://messages.example", {
      kind: "text",
      text: "next",
    }),
  ).rejects.toThrow(/already pending/i);
  observed = { actionId: "22".repeat(16), state: "confirmed" };
  expect(await factory.pending("https://messages.example")).toBeNull();
  await expect(
    factory.startReview("https://messages.example", {
      kind: "text",
      text: "next",
    }),
  ).rejects.toThrow(/already pending/i);
  observed = { actionId: id, state: "confirmed" };
  expect(await factory.pending("https://messages.example")).toBeNull();
  expect(
    await factory.startReview("https://messages.example", {
      kind: "text",
      text: "next",
    }),
  ).toBeDefined();
  expect(reviews).toBe(2);
});

test("resume-confirmed releases only its own completed slot", async () => {
  const Factory = await loadFactory();
  const id = "11".repeat(16);
  const factory = new Factory({
    prepare: async () => ({
      facts: { actionId: id, text: "hello" },
      assertCurrent: async () => {},
      approve: async () => ({
        actionId: id,
        state: "pending",
        preparation: {},
      }),
      close: () => {},
    }),
    resume: async () => ({ actionId: id, state: "confirmed" }),
  });
  const first = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  await factory.acceptApproval(first.approvalId, { assertCurrent: () => {} });
  expect(await factory.resume("https://messages.example", id)).toEqual({
    actionId: id,
    state: "confirmed",
  });
  expect(
    await factory.startReview("https://messages.example", {
      kind: "text",
      text: "next",
    }),
  ).toBeDefined();
});

test("pending never exposes an old slot after the selected account changes", async () => {
  const Factory = await loadFactory();
  let selected = true;
  const factory = new Factory({
    prepare: async () => ({
      facts: { actionId: "11".repeat(16), text: "hello" },
      assertCurrent: async () => {
        if (!selected) throw Error("account changed");
      },
      approve: async () => ({
        actionId: "11".repeat(16),
        state: "pending",
        preparation: {},
      }),
      close: () => {},
    }),
    pending: async () =>
      selected ? { actionId: "11".repeat(16), state: "pending" } : null,
  });
  const first = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  await factory.acceptApproval(first.approvalId, { assertCurrent: () => {} });
  selected = false;
  expect(await factory.pending("https://messages.example")).toBeNull();
});

test("a settled original releases the in-memory approval slot for the next direct action", async () => {
  const Factory = await loadFactory();
  const factory = new Factory({
    prepare: async () => ({
      facts: { actionId: "11".repeat(16), text: "hello" },
      assertCurrent: async () => {},
      approve: async () => ({
        actionId: "11".repeat(16),
        state: "pending",
        preparation: {},
      }),
      close: () => {},
    }),
    status: async () => ({ actionId: "11".repeat(16), state: "confirmed" }),
  });
  const first = await factory.startReview("https://messages.example", {
    kind: "text",
    text: "hello",
  });
  expect(
    (
      await factory.acceptApproval(first.approvalId, {
        assertCurrent: () => {},
      })
    ).state,
  ).toBe("pending");
  expect(
    (await factory.status("https://messages.example", "11".repeat(16))).state,
  ).toBe("confirmed");
  expect(
    (
      await factory.startReview("https://messages.example", {
        kind: "text",
        text: "again",
      })
    ).facts.actionId,
  ).toBe("11".repeat(16));
});

test("popup facts are disclosed only under the retained private fence", async () => {
  const Factory = await loadFactory();
  let current = true;
  const factory = new Factory({
    prepare: async () => ({
      facts: { actionId: "22".repeat(16), text: "secret note" },
      assertCurrent: async () => {
        if (!current) throw Error("changed");
      },
      approve: async () => {
        throw Error("unused");
      },
      close: () => {},
    }),
  });
  const review = await factory.startReview("https://messages.example", {
    kind: "invite",
    note: "secret note",
  });
  expect(
    (await factory.reviewFacts(review.approvalId, { assertCurrent: () => {} }))
      .text,
  ).toBe("secret note");
  current = false;
  await expect(
    factory.reviewFacts(review.approvalId, { assertCurrent: () => {} }),
  ).rejects.toThrow("changed");
});

test("fresh replay may advance the selected head but cannot change approved authority", async () => {
  const source = readFileSync(
    resolve("lib/zkas/direct-action-factory.ts"),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("export function sameReviewAuthority"),
    source.indexOf("// PRODUCTION_BACKEND"),
  );
  const code = await transform(body, {
    loader: "ts",
    format: "iife",
    globalName: "AuthorityTest",
    target: "es2022",
  });
  const same = new Function(
    code.code + "\nreturn AuthorityTest.sameReviewAuthority;",
  )() as (a: unknown, b: unknown) => boolean;
  const review = {
    kind: "text",
    ownerPeerId: "11".repeat(16),
    recipientPeerId: "22".repeat(16),
    recipientCard: new Uint8Array(184).fill(3),
    addresses: {
      sender: "a",
      peer: "b",
      cache: "c",
      archive: "d",
      collector: "e",
    },
    rawAddresses: {
      sender: new Uint8Array(43).fill(1),
      peer: new Uint8Array(43).fill(2),
      cache: new Uint8Array(43).fill(3),
      archive: new Uint8Array(43).fill(4),
      collector: new Uint8Array(43).fill(5),
    },
    explicitTotalSompi: "10000003",
    maxNetworkFeeSompi: "5000000",
    maximumTotalSompi: "15000003",
    sourceGeneration: 7n,
    birthHash: "33".repeat(32),
    sessionId: "44".repeat(16),
    referenceActionId: "55".repeat(16),
    decision: null,
    text: "hello",
    actionId: "66".repeat(16),
    token: new Uint8Array(16),
    selectedReviewTipHash: "77".repeat(32),
    selectedReviewTipDaa: 100n,
  };
  expect(
    same(review, {
      ...review,
      actionId: "88".repeat(16),
      selectedReviewTipHash: "99".repeat(32),
      selectedReviewTipDaa: 101n,
    }),
  ).toBe(true);
  expect(same(review, { ...review, text: "changed" })).toBe(false);
  expect(same(review, { ...review, sourceGeneration: 8n })).toBe(false);
  expect(
    same(review, {
      ...review,
      rawAddresses: {
        ...review.rawAddresses,
        peer: new Uint8Array(43).fill(9),
      },
    }),
  ).toBe(false);
  expect(
    same(review, { ...review, recipientCard: new Uint8Array(184).fill(4) }),
  ).toBe(false);
});
