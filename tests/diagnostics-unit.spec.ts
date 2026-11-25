import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import { english } from "viem/accounts";
import { buildDiagnosticReport } from "@/lib/diagnostics";
import * as consolidate from "@/lib/consolidate";
import * as diagnostics from "@/lib/diagnostics";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** lib/diagnostics.ts evaluated with `redactString` replaced. */
function withScrubber(redactString: (text: string) => unknown) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib/diagnostics.ts"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} as typeof diagnostics };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      if (id !== "@/lib/sentry-scrub") throw new Error(`unexpected ${id}`);
      return { redactString };
    },
    module,
    module.exports,
  );
  return module.exports;
}

const TXID = "c".repeat(64);
const ADDRESS =
  "kaspa:qpamkvhgh0kzx50gwvvp5xs8ktmqutcy3dfs9dc3w7lm9rq0zs76vf959mmrp";
const SEED = english.slice(0, 12).join(" ");

test.describe("buildDiagnosticReport", () => {
  test("redacts a txid and a kaspa address inside the error", () => {
    const report = buildDiagnosticReport(
      "optimize",
      new Error(`input ${TXID}:0 of ${ADDRESS} is already spent`),
    );
    expect(report).not.toBeNull();
    const copied = JSON.stringify(report);
    expect(copied).not.toContain(TXID);
    expect(copied).not.toContain(ADDRESS);
    expect(copied).not.toMatch(/[0-9a-f]{32,}/i);
    expect(report!.error).toBe(
      "Error: input [REDACTED]:0 of [ADDRESS] is already spent",
    );
    expect(report!.flow).toBe("optimize");
  });

  test("redacts a 12-word seed phrase inside a message", () => {
    const report = buildDiagnosticReport("send", new Error(`bad ${SEED}`), {
      note: `user pasted ${SEED}`,
    });
    expect(report).not.toBeNull();
    const copied = JSON.stringify(report);
    for (const word of SEED.split(" ")) {
      expect(copied).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    expect(report!.note).toBe("user pasted [REDACTED]");
  });

  test("includes the .cause text, scrubbed, after the error", () => {
    const report = buildDiagnosticReport(
      "optimize",
      new Error("No UTXOs to consolidate", {
        cause: new Error(`node refused ${TXID}`),
      }),
      { error: "caller cannot replace it", networkId: "mainnet", total: 3 },
    );
    expect(report).not.toBeNull();
    expect(Object.keys(report!)).toEqual([
      "flow",
      "error",
      "cause",
      "networkId",
      "total",
      "timestamp",
    ]);
    expect(report!.error).toBe("Error: No UTXOs to consolidate");
    expect(report!.cause).toBe("Error: node refused [REDACTED]");
    expect(report!.total).toBe(3);
  });

  test("scrubs before cutting, so a straddling txid is never half-kept", () => {
    const head = "x".repeat(1000 - "Error: ".length - 10);
    const report = buildDiagnosticReport("send", new Error(head + TXID));
    expect(report!.error.length).toBeLessThanOrEqual(1000);
    expect(report!.error).not.toMatch(/c{10,}/);
  });

  test("a failing scrub yields no report, never the raw string", () => {
    const secret = `${TXID} ${ADDRESS}`;
    const throwing = withScrubber(() => {
      throw new Error("scrubber broke");
    });
    expect(throwing.buildDiagnosticReport("send", new Error(secret))).toBe(
      null,
    );
    const unusable = withScrubber(() => undefined);
    expect(unusable.buildDiagnosticReport("send", new Error(secret))).toBe(
      null,
    );
    const nonString = withScrubber(() => ({ replace: () => 42 }));
    expect(nonString.buildDiagnosticReport("send", new Error(secret))).toBe(
      null,
    );
  });

  test("an error that cannot be stringified yields no report", () => {
    const secretText = `${TXID}`;
    const hostile = {
      toString() {
        throw new Error(secretText);
      },
    };
    expect(buildDiagnosticReport("send", hostile)).toBe(null);
    const badCause = Object.defineProperty(new Error("x"), "cause", {
      get() {
        throw new Error(secretText);
      },
    });
    expect(buildDiagnosticReport("send", badCause)).toBe(null);
  });

  test("consolidate re-exports the moved helpers unchanged", () => {
    expect(consolidate.buildRoundReport).toBe(diagnostics.buildRoundReport);
    expect(consolidate.reportError).toBe(diagnostics.reportError);
    expect(consolidate.scrubReportText).toBe(diagnostics.scrubReportText);
  });
});
