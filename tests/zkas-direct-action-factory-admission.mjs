import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cwd } from "node:process";
import { transform } from "esbuild";
const root = cwd();
const prod = await readFile(
  root + "/lib/zkas/direct-action-factory.ts",
  "utf8",
);
const author = await readFile(
  root + "/tests/zkas-direct-action-factory-production.spec.ts",
  "utf8",
);
const begin = author.indexOf("const prelude = " + String.fromCharCode(96)) + 17;
const end = author.indexOf(String.fromCharCode(96) + ";", begin);
let prelude = author.slice(begin, end);
assert(prelude.includes("const events ="));
const strip = (s) => s.replace(/^import[\s\S]*?;\n/gm, "");
const gate = strip(
  await readFile(root + "/lib/zkas/payment-account-gate.ts", "utf8"),
);
const journal = strip(
  await readFile(root + "/lib/zkas/batch-journal.ts", "utf8"),
).split("let journal: ZKasBatchJournal")[0];
const payment = strip(
  await readFile(root + "/lib/zkas/batch-payment.ts", "utf8"),
);
const evidence = strip(
  await readFile(root + "/lib/zkas/batch-settlement-evidence.ts", "utf8"),
).replaceAll("sha256Text", "sha256EvidenceText");
const built = await transform(
  "const assertBatchOrigin=()=>{};" + evidence + gate + journal + payment,
  { loader: "ts", format: "iife", globalName: "Actual", target: "es2022" },
);
const actual = new Function(built.code + ";return Actual;")();
globalThis.__actualJournal = actual.ZKasBatchJournal;
globalThis.__actualPayment = actual.ZKasBatchPayment;
const collector =
  "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv";
prelude = prelude
  .replace(
    "let actorCounter = 0;",
    "let actorCounter = globalThis.__actorSerial ?? 0;",
  )
  .replace("(++actorCounter)", "(globalThis.__actorSerial=++actorCounter)");
prelude = prelude.replace(
  "idempotencyKey:'66'.repeat(32)",
  "idempotencyKey:original.actionId.repeat(2)",
);
prelude = prelude.replace(
  "logicalId:'66'.repeat(32),capability",
  "logicalId:intent.logicalId,capability",
);
prelude = prelude.replace(
  "events.push('pin');globalThis.__factoryPinGeneration=(globalThis.__factoryPinGeneration??0)+1;",
  "events.push('pin');globalThis.__factoryPinGeneration=(globalThis.__factoryPinGeneration??0)+1;if(globalThis.__rotateAtPin)globalThis.__generation++;",
);
prelude = prelude.replace(
  "collector:'zkas:collector'",
  "collector:" + JSON.stringify(collector),
);
prelude = prelude.replace(
  "'zkas:'+role",
  "(role==='collector'?" + JSON.stringify(collector) + ":'zkas:'+role)",
);
prelude = prelude.replace(
  "checkSelection:async()=>{}};",
  "checkSelection:async()=>{},openPrivateBatchSigner:async()=>({importTicket:async(ticket)=>{events.push('import');if(ticket!==globalThis.__ticket)throw Error('ticket changed');},verifyFinalized:async(bytes)=>{events.push('verify');if(bytes.sha256!==globalThis.__settled.sha256)throw Error('bytes changed');},close:()=>events.push('close')})};",
);
const journalStart = prelude.indexOf("    const journal="),
  clientStart = prelude.indexOf("    class ZKasBatchClient");
prelude =
  prelude.slice(0, journalStart) +
  `    const journal=globalThis.__journal;
    const getZKasBatchJournal=async()=>journal;
` +
  prelude.slice(clientStart);
const paymentStart = prelude.indexOf("    class ZKasBatchPayment"),
  fetchStart = prelude.indexOf("    const fetch=");
prelude =
  prelude.slice(0, paymentStart) +
  `    const ZKasBatchPayment=globalThis.__actualPayment;
` +
  prelude.slice(fetchStart);
prelude = prelude.replace(
  "async grant(){",
  "async discoverRecords(){events.push('inventory');return {inventoryOnly:true,epoch:(++globalThis.__walk).toString(16).padStart(64,'0'),entries:globalThis.__settled?[{logicalId:globalThis.__settled.logicalId,revision:globalThis.__walk,status:'unknown',txid:globalThis.__settled.txid,sha256:globalThis.__settled.sha256}]:[],unlistedReservationCount:0};} async status(intent){events.push('status');return {status:'settled',logicalId:intent.logicalId,txid:globalThis.__settled.txid,sha256:globalThis.__settled.sha256};} async submit(intent,signed){events.push('submit');return {status:'settled',logicalId:intent.logicalId,txid:signed.txid,sha256:signed.sha256};} async grant(intent){",
);
const body = prod.slice(prod.indexOf("export class DirectActionFactory"));
const compiled = await transform(prelude + body, {
  loader: "ts",
  format: "iife",
  globalName: "Factory",
  target: "es2022",
});

function fresh() {
  return new Function(compiled.code + ";return Factory;")().directActionFactory;
}
function reset() {
  let value = null;
  globalThis.__journal = new actual.ZKasBatchJournal(
    {
      getValue: async () => structuredClone(value),
      updateValue: async (_key, fn) => {
        value = structuredClone(await fn(value));
      },
    },
    async () => false,
  );
  globalThis.__factoryEvents = [];
  globalThis.__generation = 0;
  globalThis.__factoryPinGeneration = 0;
  globalThis.__rotateAtPin = false;
  globalThis.__settled = null;
  globalThis.__ticket = null;
  globalThis.__walk = 0;
  return () => value;
}
const origin = "https://messages.example",
  input = {
    kind: "invite",
    publicCard: "03" + "07".repeat(183),
    note: "hello",
  };
async function approve(f) {
  const review = await f.startReview(origin, input);
  return {
    review,
    result: await f.acceptApproval(review.approvalId, {
      assertCurrent: () => {},
    }),
  };
}
reset();
let f = fresh();
let control = await approve(f);
assert.equal(control.result.state, "pending");
assert.equal(globalThis.__factoryEvents.filter((x) => x === "fetch").length, 1);
console.log(
  "CONTROL PASS: actual journal/payment admission issues one capability after durable intent; native/history boundary synthetic",
);
reset();
f = fresh();
let review = await f.startReview(origin, input);
globalThis.__generation++;
let before = await f.acceptApproval(review.approvalId, {
  assertCurrent: () => {},
});
assert.equal(before.state, "unknown");
assert(!globalThis.__factoryEvents.includes("seal"));
assert(!globalThis.__factoryEvents.includes("fetch"));
console.log(
  "CONTROL PASS: pairing change before approval prevents native seal and grant",
);
reset();
f = fresh();
review = await f.startReview(origin, input);
globalThis.__rotateAtPin = true;
let after = await f.acceptApproval(review.approvalId, {
  assertCurrent: () => {},
});
assert.equal(after.state, "unknown");
assert.equal(globalThis.__generation, 1);
assert(!globalThis.__factoryEvents.includes("fetch"));
console.log(
  "PASS: pairing change during pin persistence cannot grant a capability",
);
const saved = reset();
f = fresh();
control = await approve(f);
const originalId = control.review.facts.actionId;
const originalLogical = control.result.preparation.logicalId;
const restarted = fresh();
globalThis.__factoryEvents.length = 0;
await assert.rejects(
  restarted.startReview(origin, input),
  /already pending|unresolved/i,
);
assert(!globalThis.__factoryEvents.includes("review"));
assert(!globalThis.__factoryEvents.includes("seal"));
assert(!globalThis.__factoryEvents.includes("pin"));
assert(!globalThis.__factoryEvents.includes("fetch"));
assert.deepEqual(Object.keys(saved()), [originalLogical]);
assert.equal(
  (
    await globalThis.__journal.pendingDirectFor(origin, {
      walletId: "wallet",
      accountIndex: 0,
      network: "mainnet",
    })
  ).directApproval.actionId,
  originalId,
);
console.log(
  "PASS: restarted worker refuses a new review before native action allocation",
);
reset();
const first = fresh(),
  second = fresh();
const firstReview = await first.startReview(origin, input);
const secondReview = await second.startReview(origin, input);
const secondResult = await second.acceptApproval(secondReview.approvalId, {
  assertCurrent: () => {},
});
assert.equal(secondResult.state, "pending");
globalThis.__factoryEvents.length = 0;
const stale = await first.acceptApproval(firstReview.approvalId, {
  assertCurrent: () => {},
});
assert.equal(stale.state, "unknown");
assert(!globalThis.__factoryEvents.includes("seal"));
assert(!globalThis.__factoryEvents.includes("pin"));
console.log("PASS: approval rechecks shared durable account gate before seal");
reset();
const otherOrigin = "https://other.example";
const other = fresh();
const otherReview = await other.startReview(otherOrigin, input);
assert.equal(
  (
    await other.acceptApproval(otherReview.approvalId, {
      assertCurrent: () => {},
    })
  ).state,
  "pending",
);
globalThis.__factoryEvents.length = 0;
await assert.rejects(
  fresh().startReview(origin, input),
  /already pending|unresolved/i,
);
assert(!globalThis.__factoryEvents.includes("review"));
console.log(
  "PASS: an unresolved action at another origin reserves the same account",
);
reset();
const inviter = fresh();
const invite = await approve(inviter);
const originalIntent = (
  await globalThis.__journal.get(invite.result.preparation.logicalId)
).intent;
const preparedTemplate = JSON.parse(
  await readFile(root + "/tests/fixtures/zkas-v3-prepared.json", "utf8"),
);
const prepared = {
  ...preparedTemplate,
  account: originalIntent.account,
  outputs: originalIntent.outputs.map((output) => ({
    recipient: output.recipient,
    amount: output.amountSompi,
    memo: output.memoHex,
  })),
  fee: originalIntent.maxFeeSompi,
};
const signatures = [{ actionIndex: 0, signatureHex: "7".repeat(128) }];
const ticket = JSON.stringify({
  format: "zkas-private-signed-payment",
  version: 1,
  approvalDigest: "8".repeat(64),
  prepared,
  signatures,
});
await globalThis.__journal.pinDirectPrepared(originalIntent, {
  session: "6".repeat(48),
  checksum: prepared.checksum,
});
await globalThis.__journal.saveSignedTicket(originalIntent, {
  signedTicket: ticket,
  session: "6".repeat(48),
  daemonIdentity: "https://daemon.example",
  preparedChecksum: prepared.checksum,
  signatures,
});
const transactionHex = "ab".repeat(100);
const sha256 = Array.from(
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(100).fill(0xab)),
  ),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");
const signed = { transactionHex, txid: "3".repeat(64), sha256 };
await globalThis.__journal.saveFinalized(originalIntent, signed);
globalThis.__ticket = ticket;
globalThis.__settled = {
  logicalId: originalIntent.logicalId,
  txid: signed.txid,
  sha256: signed.sha256,
};
const completed = await inviter.complete(origin, invite.review.facts.actionId);
assert.deepEqual(completed, {
  actionId: invite.review.facts.actionId,
  state: "confirmed",
});
assert.equal(
  (await globalThis.__journal.get(originalIntent.logicalId)).status,
  "unknown",
);
const restartedConfirmed = fresh();
assert.deepEqual(
  await restartedConfirmed.status(origin, invite.review.facts.actionId),
  { actionId: invite.review.facts.actionId, state: "confirmed" },
);
assert.equal(await restartedConfirmed.pending(origin), null);
globalThis.__factoryEvents.length = 0;
const nextReview = await restartedConfirmed.startReview(origin, input);
assert.notEqual(nextReview.facts.actionId, invite.review.facts.actionId);
assert.equal(
  (await globalThis.__journal.get(originalIntent.logicalId)).status,
  "settled",
);
const settledEvents = globalThis.__factoryEvents;
assert.equal(settledEvents.filter((event) => event === "inventory").length, 2);
assert(settledEvents.indexOf("import") < settledEvents.indexOf("verify"));
assert(settledEvents.indexOf("verify") < settledEvents.indexOf("status"));
assert(settledEvents.indexOf("status") < settledEvents.indexOf("review"));
assert(!settledEvents.includes("grant"));
assert(!settledEvents.includes("seal"));
console.log(
  "PASS: signed original is freshly verified and settled before the next review, without a grant",
);
console.log(
  "No keys/signatures/payments/network. Actual factory/journal/payment classes; native/history/transport synthetic.",
);
