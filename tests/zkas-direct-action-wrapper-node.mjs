import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ZKAS_MAINNET_GENESIS } from "../lib/zkas/history-config.ts";

const root = path.resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  await readFile(
    path.join(root, "tests/fixtures/zkas-direct-action-flow.json"),
  ),
);
const wasm = new Uint8Array(
  await readFile(
    path.join(root, "wasm/mj3-wallet/mj3_message_wallet_bindings_bg.wasm"),
  ),
);
const raw = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const stageIndex = (daa) =>
  fixture.pages.findIndex((page) => page.page.blocks?.[0]?.daa === String(daa));
const bodyById = new Map(
  [fixture.funding, fixture.invite, fixture.accept, fixture.text].map(
    (body) => [body.txid, body.rpcTransactionJson],
  ),
);
const accountMethods = (wrapper) => ({
  refresh: () => wrapper.directRefreshStart(),
  next: () => wrapper.directNextRequest(4),
  page: (bytes) => wrapper.directAcceptPage(bytes),
  nextBody: () => wrapper.directNextBodyRequest(),
  body: (bytes) => wrapper.directAcceptBody(bytes),
  status: () => wrapper.directReceiveStatus(),
});
const nativeMethods = (wallet) => ({
  refresh: () => wallet.direct_refresh_start(),
  next: () => wallet.direct_next_request(4),
  page: (bytes) => wallet.direct_accept_page(bytes),
  nextBody: () => wallet.direct_next_body_request(),
  body: (bytes) => wallet.direct_accept_body(bytes),
  status: () => wallet.direct_receive_status(),
});
function replay(actor, lastIndex, configuredGenesis = fixture.genesisHex) {
  actor.refresh();
  const selected = fixture.pages[lastIndex].page.blocks[0];
  const tip = {
    hash: selected.hash,
    daa: selected.daa,
    blueScore: selected.blueScore,
  };
  for (let i = 0; i <= lastIndex; i++) {
    const page = structuredClone(fixture.pages[i]);
    page.source.configuredGenesis = configuredGenesis;
    page.tipBefore = tip;
    page.tipAfter = tip;
    page.page.sinkBlueScore = tip.blueScore;
    assert.equal(actor.next(), page.request.after);
    let progress;
    try {
      progress = actor.page(Buffer.from(JSON.stringify(page)));
    } catch (error) {
      throw new Error(`page ${i} rejected: ${String(error)}`, { cause: error });
    }
    const txid = actor.nextBody();
    if (txid !== undefined) {
      assert.equal(progress, 0);
      assert.equal(actor.body(Buffer.from(bodyById.get(txid))), 1);
    } else assert.equal(progress, 1);
  }
  const tail = structuredClone(fixture.pages.at(-1));
  tail.source.configuredGenesis = configuredGenesis;
  tail.request.after = tip.hash;
  tail.tipBefore = tip;
  tail.tipAfter = tip;
  tail.page.sinkBlueScore = tip.blueScore;
  assert.equal(actor.next(), tip.hash);
  assert.equal(actor.page(Buffer.from(JSON.stringify(tail))), 1);
  assert.equal(actor.status(), 1);
}
const directory = await mkdtemp(
  path.join(tmpdir(), "zkas-direct-action-wrapper-"),
);
try {
  const codecOutput = path.join(directory, "codec.mjs");
  await build({
    entryPoints: [path.join(root, "lib/zkas/direct-action-codec.ts")],
    outfile: codecOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const codec = await import(pathToFileURL(codecOutput).href);
  const aliceAddress = codec.raw43ToZkasAddress(raw(fixture.aliceAddressHex));
  const outfile = path.join(directory, "wrapper.mjs");
  await build({
    entryPoints: [path.join(root, "lib/zkas/message-profile.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "local-wasm-url",
        setup(build) {
          build.onResolve(
            { filter: /mj3_message_wallet_bindings_bg\.wasm\?url$/ },
            () => ({ path: "local-mj3-wasm", namespace: "test-url" }),
          );
          build.onLoad({ filter: /.*/, namespace: "test-url" }, () => ({
            contents: 'export default "local-mj3-wasm";',
            loader: "js",
          }));
        },
      },
    ],
  });
  globalThis.fetch = async (input) => {
    assert.equal(input, "local-mj3-wasm");
    return new Response(wasm);
  };
  const wrapper = await import(pathToFileURL(outfile).href);
  const seed = raw(fixture.aliceSeedHex);
  const account = await wrapper.createPrivateMessagingAccount(
    seed,
    aliceAddress,
    new AbortController().signal,
  );
  assert(seed.every((byte) => byte === 0));
  assert.equal(typeof account.directReviewInvite, "function");
  account.directSessionStart(
    "mainnet",
    "fixed-daemon",
    raw("31".repeat(16)),
    raw(fixture.birthHash),
    1n,
    1n,
    BigInt(fixture.sourceGeneration),
  );
  account.directConfigure(raw(fixture.collectorHex), new Uint8Array());
  replay(accountMethods(account), stageIndex(100), ZKAS_MAINNET_GENESIS);
  // The raw fixture signs a synthetic genesis; this production wrapper fixes the
  // true mainnet genesis and cannot turn that fixture into an approved draft.
  assert.throws(() =>
    account.directReviewInvite(raw(fixture.bobCardHex), "hello", "7000000"),
  );
  assert.equal(account.directSealedStatus(), null);
  account.directRefreshStart();
  assert.equal(account.directSealedStatus(), null);
  account.close();
  assert.throws(() => account.directSealedStatus());

  const userCollector = raw(
    "b676d61cabef82d1837ffe0f0c69a2002bedb7bd371c1c0b6654dffd2618070be9dfe22640c6c399b2ac22",
  );
  const canonical = codec.raw43ToZkasAddress(userCollector);
  assert.equal(
    canonical,
    "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv",
  );
  const sdk = await import(
    pathToFileURL(path.join(root, "wasm/zkas-signer/firecash_signer.js")).href
  );
  sdk.initSync({
    module: await readFile(
      path.join(root, "wasm/zkas-signer/firecash_signer_bg.wasm"),
    ),
  });
  assert.equal(sdk.Address.validate(canonical), true);
  assert.throws(() => codec.raw43ToZkasAddress(raw("00".repeat(42))));

  const nativeModule = await import(
    pathToFileURL(
      path.join(root, "wasm/mj3-wallet/mj3_message_wallet_bindings.js"),
    ).href
  );
  nativeModule.initSync({ module: wasm });
  const native = nativeModule.PrivateMj3Account.new_from_canonical_address(
    raw(fixture.aliceSeedHex),
    raw(fixture.genesisHex),
    aliceAddress,
  );
  native.direct_session_start(
    "mainnet",
    "fixed-daemon",
    raw("33".repeat(16)),
    raw(fixture.birthHash),
    1n,
    1n,
    BigInt(fixture.sourceGeneration),
  );
  native.direct_receive_configure(raw(fixture.collectorHex), new Uint8Array());
  replay(nativeMethods(native), stageIndex(100));
  const reviewBytes = Uint8Array.from(
    native.direct_review_invite(raw(fixture.bobCardHex), "hello", "7000000"),
  );
  const reviewed = codec.decodeNativeDirectReview(
    reviewBytes,
    raw(fixture.collectorHex),
  );
  assert.equal(reviewed.actionId.length, 32);
  assert.throws(() =>
    codec.decodeNativeDirectReview(
      reviewBytes.subarray(0, reviewBytes.length - 1),
      raw(fixture.collectorHex),
    ),
  );
  assert.throws(() =>
    codec.decodeNativeDirectReview(
      Uint8Array.from([...reviewBytes, 0]),
      raw(fixture.collectorHex),
    ),
  );
  assert.throws(() =>
    codec.decodeNativeDirectReview(reviewBytes, raw("01".repeat(43))),
  );
  const wrongTotal = Uint8Array.from(reviewBytes);
  const explicitOffset =
    new TextEncoder().encode("MJ3-DIRECT-REVIEW-V1\0").length +
    16 +
    16 +
    1 +
    16 +
    16 +
    184 +
    5 * 43;
  wrongTotal[explicitOffset + 7] ^= 1;
  assert.throws(() =>
    codec.decodeNativeDirectReview(wrongTotal, raw(fixture.collectorHex)),
  );
  const nativeSealed = Uint8Array.from(
    native.direct_approve_and_seal(
      reviewed.token,
      raw(reviewed.selectedReviewTipHash),
      reviewed.selectedReviewTipDaa,
      reviewed.sourceGeneration,
    ),
  );
  const decodedSealed = codec.decodeNativeDirectSealed(nativeSealed, reviewed);
  const changedCollectorMemo = Uint8Array.from(nativeSealed);
  changedCollectorMemo[changedCollectorMemo.length - 1] = 1;
  assert.throws(() =>
    codec.decodeNativeDirectSealed(changedCollectorMemo, reviewed),
  );
  assert.throws(() =>
    codec.decodeNativeDirectSealed(
      nativeSealed.subarray(0, nativeSealed.length - 1),
      reviewed,
    ),
  );
  const changedRole = Uint8Array.from(nativeSealed);
  const recordStart = nativeSealed.length - 4 * (1 + 43 + 8 + 512);
  changedRole[recordStart] = 2;
  assert.throws(() => codec.decodeNativeDirectSealed(changedRole, reviewed));
  decodedSealed.outputs[0].memo.fill(0);
  assert.notEqual(
    nativeSealed[recordStart + 1 + 43 + 8],
    0,
    "decoded memo owns its bytes",
  );
  const rawStatus = Uint8Array.from(native.direct_sealed_status());
  assert.equal(
    codec.decodeNativeDirectSealedStatus(rawStatus).actionId,
    reviewed.actionId,
  );
  assert.throws(() =>
    codec.decodeNativeDirectSealedStatus(Uint8Array.from([...rawStatus, 0])),
  );
  const nativeBob = nativeModule.PrivateMj3Account.new_from_canonical_address(
    raw(fixture.bobSeedHex),
    raw(fixture.genesisHex),
    codec.raw43ToZkasAddress(raw(fixture.bobAddressHex)),
  );
  nativeBob.direct_session_start(
    "mainnet",
    "fixed-daemon",
    raw("34".repeat(16)),
    raw(fixture.birthHash),
    1n,
    1n,
    BigInt(fixture.sourceGeneration),
  );
  nativeBob.direct_receive_configure(
    raw(fixture.collectorHex),
    new Uint8Array(),
  );
  replay(nativeMethods(nativeBob), stageIndex(700));
  const decisionBytes = nativeBob.direct_review_decision(
    raw(reviewed.ownerPeerId),
    raw(fixture.invite.actionId),
    1,
    "yes",
    "7000000",
  );
  const decision = codec.decodeNativeDirectReview(
    decisionBytes,
    raw(fixture.collectorHex),
  );
  assert.equal(decision.kind, "decision");
  assert.equal(decision.decision, "accept");
  assert.equal(decision.referenceActionId, fixture.invite.actionId);
  assert.equal(hex(decision.recipientCard), fixture.aliceCardHex);
  const decisionSealed = codec.decodeNativeDirectSealed(
    nativeBob.direct_approve_and_seal(
      decision.token,
      raw(decision.selectedReviewTipHash),
      decision.selectedReviewTipDaa,
      decision.sourceGeneration,
    ),
    decision,
  );
  assert.deepEqual(
    decisionSealed.outputs.map((output) => output.amountSompi),
    ["1", "1", "1", "10000000"],
  );
  nativeBob.close();
  nativeBob.free();

  const nativeAliceText =
    nativeModule.PrivateMj3Account.new_from_canonical_address(
      raw(fixture.aliceSeedHex),
      raw(fixture.genesisHex),
      aliceAddress,
    );
  nativeAliceText.direct_session_start(
    "mainnet",
    "fixed-daemon",
    raw("35".repeat(16)),
    raw(fixture.birthHash),
    1n,
    1n,
    BigInt(fixture.sourceGeneration),
  );
  nativeAliceText.direct_receive_configure(
    raw(fixture.collectorHex),
    raw(fixture.bobCardHex),
  );
  replay(nativeMethods(nativeAliceText), stageIndex(1301));
  const textBytes = nativeAliceText.direct_review_text(
    raw(reviewed.recipientPeerId),
    "next",
    "7000000",
  );
  const textReview = codec.decodeNativeDirectReview(
    textBytes,
    raw(fixture.collectorHex),
  );
  assert.equal(textReview.kind, "text");
  assert.equal(textReview.text, "next");
  assert.equal(textReview.referenceActionId, fixture.invite.actionId);
  const textSealed = codec.decodeNativeDirectSealed(
    nativeAliceText.direct_approve_and_seal(
      textReview.token,
      raw(textReview.selectedReviewTipHash),
      textReview.selectedReviewTipDaa,
      textReview.sourceGeneration,
    ),
    textReview,
  );
  assert.equal(textSealed.outputs.length, 4);
  nativeAliceText.close();
  nativeAliceText.free();
  native.close();
  native.free();
  console.log(
    "PASS action7 WASM codec: synthetic invite/decision/text seals, malformed binary controls; production mainnet wrapper rejects synthetic-genesis action",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
