// Public dummy SDK fixture. Its synthetic note/path is not live payment proof.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
execFileSync(
  process.execPath,
  [path.join(root, "scripts/check-zkas-batch-signer.mjs")],
  { cwd: root },
);
const wasm = new Uint8Array(
  await readFile(
    path.join(root, "wasm/zkas-batch/zkas_browser_signer_bg.wasm"),
  ),
);
const oldWasm = new Uint8Array(
  await readFile(path.join(root, "wasm/zkas-signer/firecash_signer_bg.wasm")),
);
const fixture = JSON.parse(
  await readFile(
    path.join(root, "tests/fixtures/zkas-batch-sdk-finalized.json"),
  ),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha(wasm),
  "390de75c80ea88159e6f47f8e5747bf3d75a504106beb2b99d2a3605c5885261",
);
const directory = await mkdtemp(
  path.join(tmpdir(), "kastle-private-batch-signer-"),
);
const output = path.join(directory, "signer.mjs");
try {
  await build({
    entryPoints: [path.join(root, "lib/zkas/signer.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "local-wasm-urls",
        setup(build) {
          build.onResolve({ filter: /\.wasm\?url$/ }, (args) => ({
            path: args.path.includes("zkas_browser_signer")
              ? "local-batch-wasm"
              : "local-other-wasm",
            namespace: "test-url",
          }));
          build.onLoad({ filter: /.*/, namespace: "test-url" }, (args) => ({
            contents: `export default ${JSON.stringify(args.path)};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const signer = await import(pathToFileURL(output).href);
  assert.equal(typeof signer.openSelectedPrivateBatchSigner, "function");
  await signer.initZKasSigner(oldWasm);
  globalThis.fetch = async (input) => {
    assert.equal(input, "local-batch-wasm");
    return new Response(wasm);
  };
  const approved = {
    selection: { walletId: "dummy", accountIndex: 0, network: "mainnet" },
    account: fixture.approvedIntent.account,
    genesis: fixture.genesisHex,
    origin: "https://matjam.mooncake.space",
    logicalId: "11".repeat(32),
    outputs: fixture.approvedIntent.outputs.map((o) => ({
      recipient: o.recipient,
      amountSompi: o.amountSompi,
      memoHex: o.memoHex,
    })),
    maxFeeSompi: fixture.approvedIntent.maxFeeSompi,
  };
  const prepared = {
    status: "prepared",
    logicalId: approved.logicalId,
    session: "22".repeat(24),
    preparedPayment: fixture.preparedEnvelope,
  };
  const raw = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
  const source = { type: "seed", value: fixture.provenance.accountSeedHex };
  const selected = fixture.approvedIntent.account;

  const bad = Uint8Array.from(wasm);
  bad[64] ^= 1;
  globalThis.fetch = async () => new Response(bad);
  await assert.rejects(
    signer.openSelectedPrivateBatchSigner(
      source,
      0,
      selected,
      approved,
      prepared,
      new AbortController().signal,
    ),
  );
  globalThis.fetch = async (input) => {
    assert.equal(input, "local-batch-wasm");
    return new Response(wasm);
  };
  await assert.rejects(
    signer.openSelectedPrivateBatchSigner(
      source,
      1,
      selected,
      approved,
      prepared,
      new AbortController().signal,
    ),
  );
  await assert.rejects(
    signer.openSelectedPrivateBatchSigner(
      source,
      0,
      approved.outputs[0].recipient,
      approved,
      prepared,
      new AbortController().signal,
    ),
  );
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    signer.openSelectedPrivateBatchSigner(
      source,
      0,
      selected,
      approved,
      prepared,
      stopped.signal,
    ),
  );

  async function rejectsPostCallRepair(label, corrupt, repair) {
    const candidateSource = structuredClone(source);
    const candidateApproved = structuredClone(approved);
    const candidatePrepared = structuredClone(prepared);
    corrupt(candidateSource, candidateApproved, candidatePrepared);
    const opening = signer.openSelectedPrivateBatchSigner(
      candidateSource,
      0,
      selected,
      candidateApproved,
      candidatePrepared,
      new AbortController().signal,
    );
    repair(candidateSource, candidateApproved, candidatePrepared);
    await assert.rejects(async () => {
      const handle = await opening;
      try {
        await handle.sign();
      } finally {
        handle.close();
      }
    }, label);
  }
  await rejectsPostCallRepair(
    "fee mutation after adapter invocation",
    (_s, a) => {
      a.maxFeeSompi = "1";
    },
    (_s, a) => {
      a.maxFeeSompi = approved.maxFeeSompi;
    },
  );
  await rejectsPostCallRepair(
    "genesis mutation after adapter invocation",
    (_s, a) => {
      a.genesis = "00".repeat(32);
    },
    (_s, a) => {
      a.genesis = approved.genesis;
    },
  );
  await rejectsPostCallRepair(
    "prepared memo mutation after adapter invocation",
    (_s, _a, p) => {
      p.preparedPayment.outputs[0].memo = "00".repeat(512);
    },
    (_s, _a, p) => {
      p.preparedPayment.outputs[0].memo =
        prepared.preparedPayment.outputs[0].memo;
    },
  );
  await rejectsPostCallRepair(
    "source mutation after adapter invocation",
    (s) => {
      s.value = "00".repeat(32);
    },
    (s) => {
      s.value = source.value;
    },
  );

  const opened = await signer.openSelectedPrivateBatchSigner(
    source,
    0,
    selected,
    approved,
    prepared,
    new AbortController().signal,
  );
  prepared.preparedPayment.outputs[0].memo = "00".repeat(512);
  const signatures = await opened.sign();
  assert.deepEqual(
    signatures.map((s) => s.actionIndex),
    [1],
  );
  assert.match(signatures[0].signatureHex, /^[0-9a-f]{128}$/);
  const ticket = await opened.exportTicket();
  assert.equal(JSON.parse(ticket).format, "zkas-private-signed-payment");
  assert.deepEqual(await opened.sign(), signatures);
  await assert.rejects(opened.verifyFinalized(fixture.validFinalized));
  opened.close();
  await assert.rejects(opened.sign());

  const recovered = await signer.openSelectedPrivateBatchSigner(
    source,
    0,
    selected,
    approved,
    undefined,
    new AbortController().signal,
  );
  await assert.rejects(recovered.sign());
  await recovered.importTicket(ticket);
  assert.equal(await recovered.exportTicket(), ticket);
  await assert.rejects(recovered.verifyFinalized(fixture.validFinalized));
  recovered.close();

  const fixtureRecovery = await signer.openSelectedPrivateBatchSigner(
    source,
    0,
    selected,
    approved,
    undefined,
    new AbortController().signal,
  );
  await fixtureRecovery.importTicket(fixture.validSignedTicket);
  await fixtureRecovery.verifyFinalized(fixture.validFinalized);
  await assert.rejects(
    fixtureRecovery.verifyFinalized({
      ...fixture.validFinalized,
      txid: "00".repeat(32),
    }),
  );
  fixtureRecovery.close();

  const aborted = new AbortController();
  const pending = signer.openSelectedPrivateBatchSigner(
    source,
    0,
    selected,
    approved,
    undefined,
    aborted.signal,
  );
  aborted.abort();
  const maybeOpened = await pending.then(
    (value) => value,
    () => undefined,
  );
  if (maybeOpened) {
    await assert.rejects(maybeOpened.exportTicket());
    maybeOpened.close();
  }

  const loaderOutput = path.join(directory, "loader.mjs");
  await build({
    entryPoints: [path.join(root, "lib/zkas/private-batch-signer.ts")],
    outfile: loaderOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "local-batch-wasm-url",
        setup(build) {
          build.onResolve(
            { filter: /zkas_browser_signer_bg\.wasm\?url$/ },
            () => ({ path: "local-batch-wasm", namespace: "test-url" }),
          );
          build.onLoad({ filter: /.*/, namespace: "test-url" }, () => ({
            contents: 'export default "local-batch-wasm";',
            loader: "js",
          }));
        },
      },
    ],
  });
  const loader = await import(pathToFileURL(loaderOutput).href);
  let releaseFetch;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releaseFetch = resolve;
    });
  const mutableApproval = structuredClone(approved);
  const copiedSeed = raw(fixture.provenance.accountSeedHex);
  const opening = loader.createPrivateBatchSigner(
    copiedSeed,
    selected,
    mutableApproval,
    undefined,
    new AbortController().signal,
  );
  assert(
    copiedSeed.every((byte) => byte === 0),
    "loader clears caller seed before first await",
  );
  mutableApproval.genesis = "56".repeat(32);
  releaseFetch(new Response(wasm));
  const snapshot = await opening;
  await snapshot.importTicket(fixture.validSignedTicket);
  await snapshot.verifyFinalized(fixture.validFinalized);
  snapshot.close();

  const oversizeLoader = await import(
    `${pathToFileURL(loaderOutput).href}?oversize`
  );
  globalThis.fetch = async () =>
    new Response(new Uint8Array(4 * 1024 * 1024 + 1));
  const oversizeSeed = raw(fixture.provenance.accountSeedHex);
  const oversizeOpen = oversizeLoader.createPrivateBatchSigner(
    oversizeSeed,
    selected,
    approved,
    undefined,
    new AbortController().signal,
  );
  assert(oversizeSeed.every((byte) => byte === 0));
  await assert.rejects(oversizeOpen);

  const deadlineLoader = await import(
    `${pathToFileURL(loaderOutput).href}?deadline`
  );
  const originalSetTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = (callback, delay, ...args) =>
      originalSetTimeout(callback, Math.min(delay, 25), ...args);
    globalThis.fetch = () => new Promise(() => undefined);
    const timedSeed = raw(fixture.provenance.accountSeedHex);
    const timedOpen = deadlineLoader.createPrivateBatchSigner(
      timedSeed,
      selected,
      approved,
      undefined,
      new AbortController().signal,
    );
    assert(timedSeed.every((byte) => byte === 0));
    await assert.rejects(timedOpen);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  console.log(
    "PASS private batch SDK: pin, 4 MiB/10 s loader bounds, selected seed/account, exact signatures/ticket/finalized bytes, abort/close",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
