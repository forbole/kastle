import { expect, test } from "@playwright/test";
import {
  parseDirectActionRequest,
  parseDirectActionId,
} from "../lib/zkas/direct-action-request";

const card = "a1".repeat(184);
const id = "ab".repeat(16);

test("paid direct requests accept only bounded canonical page payloads", () => {
  expect(
    parseDirectActionRequest("invite", { publicCard: card, note: "hi" }),
  ).toEqual({
    kind: "invite",
    publicCard: card,
    note: "hi",
  });
  expect(
    parseDirectActionRequest("decision", {
      inviterId: id,
      invitationActionId: id,
      decision: "reject",
      note: "",
    }),
  ).toEqual({
    kind: "decision",
    inviterId: id,
    invitationActionId: id,
    decision: "reject",
    note: "",
  });
  expect(
    parseDirectActionRequest("text", { peerId: id, text: "hello" }),
  ).toEqual({
    kind: "text",
    peerId: id,
    text: "hello",
  });
  expect(parseDirectActionId({ actionId: id })).toBe(id);
});

test("page cannot inject account, origin, source, approval or native token", () => {
  for (const extra of [
    "account",
    "origin",
    "daemonUrl",
    "approved",
    "token",
    "maxFeeSompi",
  ]) {
    expect(() =>
      parseDirectActionRequest("invite", {
        publicCard: card,
        note: "",
        [extra]: "injected",
      }),
    ).toThrow();
  }
  expect(() =>
    parseDirectActionId({ actionId: id, account: "override" }),
  ).toThrow();
});

test("UTF-8 and fixed IDs are bounded before native review", () => {
  expect(() =>
    parseDirectActionRequest("invite", {
      publicCard: card.toUpperCase(),
      note: "",
    }),
  ).toThrow();
  expect(() =>
    parseDirectActionRequest("invite", {
      publicCard: card,
      note: "界".repeat(12),
    }),
  ).toThrow();
  expect(() =>
    parseDirectActionRequest("decision", {
      inviterId: id,
      invitationActionId: id,
      decision: "accept",
      note: "界".repeat(11),
    }),
  ).toThrow();
  expect(() =>
    parseDirectActionRequest("text", { peerId: id, text: "" }),
  ).toThrow();
  expect(() =>
    parseDirectActionRequest("text", { peerId: id, text: "界".repeat(73) }),
  ).toThrow();
  expect(() => parseDirectActionId({ actionId: "AB".repeat(16) })).toThrow();
});
