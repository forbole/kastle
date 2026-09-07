import { createElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "@playwright/test";
import { describeTokenOperationError } from "@/lib/token-operation-error";

// The mint/deploy fail screen renders what perform() rejected with. An Error
// object in a render position is React error #31 ("Objects are not valid as a
// React child") — the crash Leo saw on a failed mint. The helper must hand the
// screen a string whatever the rejection was.
test.describe("token operation fail screen (Defect 1)", () => {
  const rejections: [string, unknown][] = [
    [
      "Error",
      new Error("Reveal transaction cannot be built: Insufficient funds"),
    ],
    ["Error subclass", new RangeError("Storage mass exceeds maximum")],
    ["string (Generator/RPC)", "Insufficient funds"],
    ["plain object", { code: -32000 }],
    ["undefined", undefined],
    ["null", null],
  ];

  for (const [label, rejection] of rejections) {
    test(`${label} rejection renders as a string`, () => {
      const { message } = describeTokenOperationError(rejection);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      // The exact render position TokenOperationFailed uses.
      expect(() =>
        renderToString(createElement("div", null, "Something: ", message)),
      ).not.toThrow();
    });
  }

  test("the control: an Error in that render position does throw", () => {
    expect(() =>
      renderToString(
        createElement(
          "div",
          null,
          "Something: ",
          new Error("x") as unknown as ReactNode,
        ),
      ),
    ).toThrow(/Objects are not valid as a React child/);
  });

  test("classifies the timeouts and disconnects perform() actually throws", () => {
    expect(describeTokenOperationError(new Error("Timeout")).kind).toBe(
      "commit_timeout",
    );
    expect(
      describeTokenOperationError(new Error("RPC disconnected")).kind,
    ).toBe("disconnected");
    expect(
      describeTokenOperationError(new Error("Could not find script UTXO")),
    ).toEqual({ kind: "default", message: "Could not find script UTXO" });
  });
});
