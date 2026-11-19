import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real OptimizeFunds page with the real useKaspaHotWalletSigner and
// useKaspaLedgerSigner: only the background signer and the Ledger device are
// stubs, backed by both derivations of one recovery phrase
// (tests/optimize-funds/vite.config.mjs, mode "real-signer").
// Account L is the legacy key of account 1 and holds 81 entries (1
// transaction); B is a key the phrase cannot derive. The wallet flag is unset
// (standard) unless a test sets `legacy=1`: with L that is the defect state.

const MISMATCH = "signing key does not match";
// SignerMismatchError's message, word for word
const MISMATCH_MESSAGE =
  "This account's signing key does not match the address its funds are held at, so Optimize funds cannot sign them. Nothing was signed or sent.";
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let base: string;
let server: http.Server;

test.beforeAll(async () => {
  const outDir = path.join(
    tmpdir(),
    `kastle-optimize-funds-derivation-${process.pid}`,
  );
  // vite.build sets NODE_ENV=production in this worker; keep it for React.
  const env = process.env.NODE_ENV;
  await build({
    configFile: path.resolve("tests/optimize-funds/vite.config.mjs"),
    mode: "real-signer",
    build: { outDir },
  });
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
  server = http.createServer((req, res) => {
    const p = path.resolve(
      outDir,
      "." + decodeURIComponent((req.url ?? "/").split("?")[0]),
    );
    if (!p.startsWith(outDir + path.sep) && p !== outDir) {
      res.writeHead(403).end();
      return;
    }
    const file =
      existsSync(p) && statSync(p).isFile()
        ? p
        : path.join(outDir, "index.html");
    res.writeHead(200, {
      "content-type":
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".wasm": "application/wasm",
        }[path.extname(file)] ?? "text/html",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => server?.close());

async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?${query}`);
  await page.waitForFunction(() => window.__optimize);
  return errors;
}

const harness = (page: Page) =>
  page.evaluate(() => {
    const {
      calls,
      signedIsLegacy,
      isLegacyBy,
      ledgerLog,
      guards,
      plans,
      rounds,
      submitted,
      failed,
    } = window.__optimize.state();
    return {
      calls,
      signedIsLegacy,
      isLegacyBy,
      ledgerLog,
      guards,
      plans,
      rounds,
      submitted,
      report: failed?.report,
    };
  });
const optimizeBtn = (page: Page) =>
  page.getByRole("button", { name: "Optimize", exact: true });

test("legacy record at index 1, flag unset: plans, then signs with the legacy key and submits", async ({
  page,
}) => {
  const errors = await open(page, "account=L&index=1");
  await expect(optimizeBtn(page)).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const txRow = page
    .locator("span", { hasText: /^Transactions$/ })
    .locator("..");
  await expect(txRow).toContainText("1");
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
  const { calls, signedIsLegacy } = await harness(page);
  expect(calls.signTx).toBe(1);
  expect(calls.submit).toBe(1);
  expect(signedIsLegacy).toEqual([true]);
  expect(errors).toEqual([]);
});

test("record the phrase cannot derive: the mismatch is shown, nothing signed", async ({
  page,
}) => {
  const errors = await open(page, "account=B&index=1");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(MISMATCH);
  await expect(alert).toContainText("Nothing was signed or sent");
  await expect(optimizeBtn(page)).toHaveCount(0);
  const { calls } = await harness(page);
  expect(calls.signTx).toBe(0);
  expect(calls.submit).toBe(0);
  expect(errors).toEqual([]);
});

// The affected user's wallet, scaled down: a hot wallet whose account 1
// record holds the legacy address L while the flag is unset (standard), with
// its funds split over many small entries (tests/optimize-funds/stubs.tsx,
// FRAGMENTED). The 2.63.0 report for this shape showed 11,457 entries and a
// first chunk of 80 unsigned inputs.
//   L: 401 spendable entries (392 below 1 KAS, 9 of 25 KAS)
//      + 1 immature coinbase payout (50 KAS, 10 DAA scores old)
//   S: 30 entries on key 1 of the same legacy account (29 below 1 KAS)
// = 432 entries, 421 below 1 KAS. 401 at 80 inputs per transaction = 5
// chunks of 80 and a lone remainder, which is not planned.
test.describe("fragmented legacy wallet at index 1, flag unset", () => {
  const FRAGMENTED = "wallet=fragmented&account=L&index=1";

  test("pre-fix selection (the raw flag): refused with SignerMismatchError before anything is signed", async ({
    page,
  }) => {
    // prefix=1: the hooks get `isLegacyWalletEnabled ?? false`, as before
    // 10e0bc6 (tests/optimize-funds/resolve-derivation-spy.ts)
    const errors = await open(page, `${FRAGMENTED}&prefix=1`);
    await expect(page.getByRole("alert")).toHaveText(MISMATCH_MESSAGE);
    await expect(optimizeBtn(page)).toHaveCount(0);
    const h = await harness(page);
    expect(h.guards).toEqual(["SignerMismatchError"]);
    expect(h.plans).toEqual([]);
    expect(h.rounds).toEqual([]);
    expect(h.calls.signTx).toBe(0);
    expect(h.calls.submit).toBe(0);
    expect(h.signedIsLegacy).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("plans 5 chunks of at most 80, signs every input with the legacy key, submits each chunk once", async ({
    page,
  }) => {
    const errors = await open(page, FRAGMENTED);
    // the planning-time ownership guard: SignerMismatchError before the fix
    await expect.poll(async () => (await harness(page)).guards).toEqual(["ok"]);
    await expect(optimizeBtn(page)).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const txRow = page
      .locator("span", { hasText: /^Transactions$/ })
      .locator("..");
    await expect(txRow).toContainText("5");

    // the fixture, as planConsolidationRound received it
    const { addresses } = await page.evaluate(() => window.__optimize);
    const [planned] = (await harness(page)).plans;
    expect(planned.entries).toBe(432);
    expect(planned.entriesByAddress).toEqual({
      [addresses.L]: 402,
      [addresses.S]: 30,
    });
    expect(planned.smallEntries).toBe(421);
    expect(planned.coinbaseEntries).toBe(1);
    expect(planned.screen).toEqual({
      spendable: 401,
      skippedCovenant: 30,
      skippedImmature: 1,
      maturityUnknown: false,
    });

    // the plan: chunks of at most 80, the lone remainder left out
    const plan = planned.plan!;
    expect(plan.chunks.map((c) => c.inputs.length)).toEqual([
      80, 80, 80, 80, 80,
    ]);
    expect(plan.inputCount).toBe(400);
    expect(plan.leftOut).toHaveLength(1);
    expect(plan.chunks.flatMap((c) => c.inputs)).not.toContain(plan.leftOut[0]);
    expect(plan.skipped).toBe(31);
    expect(plan.skippedCovenant).toBe(30);
    expect(plan.skippedImmature).toBe(1);

    await optimizeBtn(page).click();
    await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
    const h = await harness(page);
    expect(h.calls.signTx).toBe(5);
    expect(h.signedIsLegacy).toEqual([true, true, true, true, true]);

    // 80 in the 2.63.0 report (first chunk), 0 now: every planned input
    // reached the node with a signature script
    const unsignedInputs = h.submitted.reduce((n, s) => n + s.unsigned, 0);
    expect(unsignedInputs).toBe(0);

    // every chunk submitted exactly once, with the inputs it was planned with
    expect(h.calls.submit).toBe(5);
    const ids = h.submitted.map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual(plan.chunks.map((c) => c.id).sort());
    for (const chunk of plan.chunks) {
      const sent = h.submitted.find((s) => s.id === chunk.id)!;
      expect(sent.inputs).toEqual(chunk.inputs);
      // the chunk's fee is what its inputs pay above its output
      expect(BigInt(chunk.inputSompi) - BigInt(sent.outputSompi)).toBe(
        BigInt(chunk.fee),
      );
    }

    // fee paid = the sum of the per-chunk fees = the plan's fee
    const chunkFees = plan.chunks.reduce((n, c) => n + BigInt(c.fee), 0n);
    expect(chunkFees).toBe(BigInt(plan.fee));
    expect(h.rounds).toEqual([
      { submitted: 5, rejected: 0, feePaid: chunkFees.toString() },
    ]);
    expect(errors).toEqual([]);
  });

  test("keyring of a different seed: refused with SignerMismatchError, nothing signed or sent", async ({
    page,
  }) => {
    const errors = await open(page, `${FRAGMENTED}&seed=other`);
    await expect(page.getByRole("alert")).toHaveText(MISMATCH_MESSAGE);
    await expect(optimizeBtn(page)).toHaveCount(0);
    const h = await harness(page);
    expect(h.guards).toEqual(["SignerMismatchError"]);
    expect(h.plans).toEqual([]);
    expect(h.calls.signTx).toBe(0);
    expect(h.calls.submit).toBe(0);
    expect(errors).toEqual([]);
  });
});

// The real useKaspaLedgerSigner, with a stub device holding the harness
// phrase (tests/optimize-funds/stubs.tsx, LedgerDevice).
test.describe("Ledger, legacy record at index 1, flag unset", () => {
  test("selects the legacy device account; a 5-transaction round reads keys twice, both before the first signature", async ({
    page,
  }) => {
    const errors = await open(
      page,
      "wallet=fragmented&account=L&index=1&ledger=1",
    );
    await expect(optimizeBtn(page)).toBeEnabled();
    await optimizeBtn(page).click();
    await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
    const h = await harness(page);
    expect(h.calls.submit).toBe(5);
    expect(h.signedIsLegacy).toEqual([true, true, true, true, true]);
    expect(h.submitted.reduce((n, s) => n + s.unsigned, 0)).toBe(0);
    expect(h.ledgerLog).toEqual([
      // the resolution: the flag's derivation, then the other one
      "getPublicKeys:standard",
      "getPublicKeys:legacy",
      // the ownership guard at planning, then before the first signature
      "getPublicKey:legacy",
      "getPublicKey:legacy",
      ...Array(5).fill("signTx:legacy"),
    ]);
    expect(errors).toEqual([]);
  });

  test("wrong device, then the correct one: Retry finds the legacy key without a reload", async ({
    page,
  }) => {
    const errors = await open(page, "account=L&index=1&ledger=1&seed=other");
    await expect(page.getByRole("alert")).toContainText(MISMATCH);
    expect((await harness(page)).ledgerLog).toEqual([
      "getPublicKeys:standard",
      "getPublicKeys:legacy",
      "getPublicKey:standard",
    ]);
    await page.evaluate(
      (seedPhrase) => window.__optimize.update({ seedPhrase }),
      MNEMONIC,
    );
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(optimizeBtn(page)).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await optimizeBtn(page).click();
    await expect(page.getByText("Optimize succeeded stub")).toBeVisible();
    const h = await harness(page);
    expect(h.guards).toEqual(["SignerMismatchError", "ok"]);
    expect(h.signedIsLegacy).toEqual([true]);
    expect(h.calls.submit).toBe(1);
    expect(errors).toEqual([]);
  });
});

// Each signing path of the real useKaspaHotWalletSigner, called on the legacy
// record with the flag unset: the background must get the legacy derivation.
test.describe("hot wallet signing paths, legacy record at index 1, flag unset", () => {
  for (const method of [
    "signInputDigest",
    "signBraidDeposit",
    "signMessage",
  ] as const) {
    test(`${method} sends isLegacy true`, async ({ page }) => {
      const errors = await open(page, "account=L&index=1");
      await page.waitForFunction(() => window.__optimize.hotSigner());
      await page.evaluate(async (method) => {
        const signer = window.__optimize.hotSigner()!;
        if (method === "signInputDigest") {
          await signer.signInputDigest(
            { serializeToSafeJSON: () => "{}" } as never,
            0,
          );
        } else if (method === "signBraidDeposit") {
          await signer.signBraidDeposit({
            ref: "probe",
            network: "mainnet",
            userPublicKey: "",
            signInputs: [],
            sighashes: [],
            walletJson: "",
          } as never);
        } else {
          await signer.signMessage("probe");
        }
      }, method);
      expect((await harness(page)).isLegacyBy[method]).toEqual([true]);
      expect(errors).toEqual([]);
    });
  }
});

test("failure report: isLegacy is the derivation used, isLegacyWalletEnabled the flag", async ({
  page,
}) => {
  const errors = await open(page, "account=L&index=1&submit=fail");
  await optimizeBtn(page).click();
  await expect(page.getByText("Optimize failed stub")).toBeVisible();
  const { report, signedIsLegacy } = await harness(page);
  expect(signedIsLegacy).toEqual([true]);
  expect(report?.rejected).toBe(1);
  expect(report?.signerMatchesPlan).toBe(true);
  expect(report?.isLegacy).toBe(true);
  expect(report?.isLegacyWalletEnabled).toBe(false);
  expect(errors).toEqual([]);
});
