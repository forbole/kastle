import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const wasmPath = path.join(
  root,
  "wasm/mj3-wallet/mj3_message_wallet_bindings_bg.wasm",
);
const pinnedWasm =
  "3a03deb43c478c54ca7c29c3726f1f9f47142761b838e3e9bf4514c198765809";
const origin = "https://matjam.mooncake.space";
const vectors = [
  {
    seed: "20468ca002014b860fce6926a03c8eeaceebb48b365160f60836cc3a111d3b38",
    address:
      "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy",
    card: "038ed378a8807a9754bf714e5d89a6bfc0bd07377141fa5467e9084db285637a48ed6436eb1522abd3b2a41131fe26ae96b276b1def2f7ce74b1ea12dcac3feacb87330710ce0fd0416dd5e1bbd564c20358e87b9f3c4adc42726c721e8936aa0fb6f58f8d717760d577c10d0000000000000000ffffffffda33fbc6f47ad5c98918fae8892a4a1f8087126175272aaf9b480b15fa54827c8e10c417e194dc44dc06d4c579c72967fb0cb721a079e68d789193db58586201",
    peer: "55e7ea1538512ae6166c8d423330fcca",
  },
  {
    seed: "fa502dd864b61baccb7eb86cd30d2eeef6a39ab32ef09b415054ea8a2c157c32",
    address:
      "zkas:p8vmwuwk2npzsjc4udm4zurtdpd76rwyqwma3j9fdda3lc4yhsp30tcesf54ehq29t66jysxg9mc25s",
    card: "03d9b771d654c2284b15e37751706b685bed0dc403b7d8c8a96b7b1fe2a4bc0317af1982695cdc0a2af5a9124a7a28c8893b30a1501fd6c34b8156c32ac392144a0fe1bf3a846d52014127ea1084c4e1a3e38a97a79b42d8ccdeaca108db85c5f26397d962356a0f0e53497c0000000000000000ffffffffd506109d447c872e066d543148a0c9610a4b2e78521c22f1a3d76f2ee0f7be6a072a0ba6837131bd0344401a07cbb9d8fd2b90c663f5d192e6913898bedc810f",
    peer: "ff4ef4ea3e278697c98ea79bdcf7677b",
  },
  {
    seed: "1111111111111111111111111111111111111111111111111111111111111111",
    address:
      "zkas:p8cktzysquhcen3l50uhnq6cagj2ypn8ylc04g0jex92nadvfkk33a8vv053cjkz5y0vrtq0y5m3828",
    card: "03f1658890072f8cce3fa3f9798358ea24a2066727f0faa1f2c98aa9f5ac4dad18f4ec63e91c4ac2a11ec1ac10f94f2330df9094565aad165eac5cab5e79a15a155682b44b66cfac8d290edb19829bdac9a6abe269918a3aa3cdaba672cf34b60468e6759d09016f64fe075f0000000000000000fffffffff97f57e1da31d9d8cfe5fc9fbfbfd77759dcea6670fd0b988071eb62d19f9bd4c715b61b672903cdc9ba813dd8633b66ebe675b5c0e0412dc9e157a9e5b54900",
    peer: "45e0a4ce44f074548995de742519a173",
  },
] as const;

let directory: string;
let output: string;

// The four public dummy fields below were frozen by an independent Python
// HKDF/Ed25519/X25519 reference against the pinned mainnet genesis.
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "kastle-message-profile-"));
  output = path.join(directory, "loader.mjs");
  await build({
    entryPoints: [path.join(root, "lib/zkas/message-profile.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "local-pinned-wasm-url",
        setup(build) {
          build.onResolve(
            { filter: /mj3_message_wallet_bindings_bg\.wasm\?url$/ },
            () => ({
              path: "local-bundled-mj3-wasm",
              namespace: "test-url",
            }),
          );
          build.onLoad({ filter: /.*/, namespace: "test-url" }, () => ({
            contents: 'export default "local-bundled-mj3-wasm";',
            loader: "js",
          }));
        },
      },
    ],
  });
});

test.afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(body: string): unknown {
  const script = `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { createHash, createPublicKey, verify } from "node:crypto";
    const privateLoader = await import(${JSON.stringify(pathToFileURL(output).href)});
    assert.deepEqual(Object.keys(privateLoader), ["createPrivateMessagingAccount"]);
    const {createPrivateMessagingAccount} = privateLoader;
    const raw = hex => Uint8Array.from(Buffer.from(hex, "hex"));
    const hex = bytes => Buffer.from(bytes).toString("hex");
    const wasm = new Uint8Array(readFileSync(${JSON.stringify(wasmPath)}));
    const vectors = ${JSON.stringify(vectors)};
    const origin = ${JSON.stringify(origin)};
    ${body}
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    }),
  );
}

test("private loader produces three independently fixed mainnet cards and peer IDs", async () => {
  const bytes = await readFile(wasmPath);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(pinnedWasm);
  expect(
    run(`
    globalThis.fetch = async input => {
      assert.equal(input, "local-bundled-mj3-wasm");
      return new Response(wasm);
    };
    const genesis = raw("b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f");
    const protocol = createHash("sha256").update("matjam-onchain-v3").digest();
    for (const v of vectors) {
      const seed = raw(v.seed);
      const account = await createPrivateMessagingAccount(seed, v.address, new AbortController().signal);
      assert(seed.every(byte => byte === 0));
      const card = account.publicCard();
      assert.equal(hex(card), v.card);
      const peer = createHash("sha256").update(genesis).update(protocol)
        .update(card.subarray(44, 76)).digest().subarray(0, 16);
      assert.equal(hex(peer), v.peer);
      account.close();
      assert.throws(() => account.publicCard());
    }
    console.log(JSON.stringify({cards: 3, peerIds: 3, cleared: 3}));
  `),
  ).toEqual({ cards: 3, peerIds: 3, cleared: 3 });
});

test("wrong pin, wrong account and aborted loads clear the seed", async () => {
  expect(
    run(`
    globalThis.fetch = async () => {
      const bad = Uint8Array.from(wasm); bad[128] ^= 1;
      return new Response(bad);
    };
    let seed = raw(vectors[0].seed);
    await assert.rejects(createPrivateMessagingAccount(seed, vectors[0].address, new AbortController().signal));
    assert(seed.every(byte => byte === 0));
    seed = new Uint8Array(31).fill(7);
    await assert.rejects(createPrivateMessagingAccount(seed, vectors[0].address, new AbortController().signal));
    assert(seed.every(byte => byte === 0));
    globalThis.fetch = async () => new Response(wasm);
    seed = raw(vectors[0].seed);
    await assert.rejects(createPrivateMessagingAccount(seed, vectors[1].address, new AbortController().signal));
    assert(seed.every(byte => byte === 0));
    const stopped = new AbortController(); stopped.abort();
    seed = raw(vectors[0].seed);
    await assert.rejects(createPrivateMessagingAccount(seed, vectors[0].address, stopped.signal));
    assert(seed.every(byte => byte === 0));
    globalThis.fetch = () => new Promise(() => undefined);
    const pending = new AbortController();
    seed = raw(vectors[0].seed);
    const opening = createPrivateMessagingAccount(seed, vectors[0].address, pending.signal);
    assert(seed.every(byte => byte === 0));
    pending.abort();
    await assert.rejects(opening);
    console.log(JSON.stringify({wrongPin:true, wrongAccount:true, preAbort:true, midAbort:true}));
  `),
  ).toEqual({
    wrongPin: true,
    wrongAccount: true,
    preAbort: true,
    midAbort: true,
  });
});

test("a stalled local module load has a bounded failure", async () => {
  expect(
    run(`
    const originalTimer = globalThis.setTimeout;
    globalThis.setTimeout = (fn, delay, ...args) =>
      originalTimer(fn, Math.min(delay, 30), ...args);
    globalThis.fetch = () => new Promise(() => undefined);
    const seed = raw(vectors[0].seed);
    await assert.rejects(
      createPrivateMessagingAccount(seed, vectors[0].address, new AbortController().signal),
      /Private messaging account rejected/,
    );
    assert(seed.every(byte => byte === 0));
    console.log(JSON.stringify({bounded:true, cleared:true}));
  `),
  ).toEqual({ bounded: true, cleared: true });
});

test("typed login and publication signatures bind purpose, origin and close", async () => {
  expect(
    run(`
    globalThis.fetch = async () => new Response(wasm);
    const cancellation = new AbortController();
    const account = await createPrivateMessagingAccount(raw(vectors[2].seed), vectors[2].address, cancellation.signal);
    const card = account.publicCard();
    const genesis = raw("b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f");
    const protocol = createHash("sha256").update("matjam-onchain-v3").digest();
    const time = n => {const out=Buffer.alloc(8);out.writeBigUInt64BE(BigInt(n));return out;};
    const claim = purpose => Buffer.concat([
      Buffer.from([1,purpose,Buffer.byteLength(origin)]),Buffer.from(origin),
      genesis,protocol,Buffer.alloc(16,1),Buffer.alloc(32,2),
      time(1790968200),time(1790968400),card,
    ]);
    const login = claim(1), publication = claim(2);
    const signed = account.signLoginAssertion(login, origin, 1790968300n);
    assert.equal(signed.length, login.length+64);
    assert.deepEqual(Buffer.from(signed.subarray(0,login.length)),login);
    const key = createPublicKey({key:Buffer.concat([
      Buffer.from("302a300506032b6570032100","hex"),card.subarray(44,76)]),
      format:"der",type:"spki"});
    assert(verify(null,Buffer.concat([Buffer.from("MJ3 identity assertion v1\\0"),login]),
      key,signed.subarray(login.length)));
    assert.throws(() => account.signCardPublicationAssertion(login,origin,1790968300n));
    assert.throws(() => account.signLoginAssertion(publication,origin,1790968300n));
    assert.throws(() => account.signLoginAssertion(login,"https://other.example",1790968300n));
    assert.throws(() => account.signLoginAssertion(login,origin,1790968500n));
    const published = account.signCardPublicationAssertion(publication,origin,1790968300n);
    assert.equal(published.length,publication.length+64);
    cancellation.abort();
    assert.throws(() => account.signLoginAssertion(login,origin,1790968300n));
    account.close();
    console.log(JSON.stringify({login:true,publication:true,bound:true,closed:true}));
  `),
  ).toEqual({ login: true, publication: true, bound: true, closed: true });
});

test("private direct receive methods remain handle-bound and expose no raw key material", async () => {
  expect(
    run(`
    globalThis.fetch = async () => new Response(wasm);
    const account = await createPrivateMessagingAccount(raw(vectors[2].seed), vectors[2].address, new AbortController().signal);
    assert.deepEqual(Object.keys(account).sort(), [
      "close", "directAcceptBody", "directAcceptPage", "directConfigure", "directNextBodyRequest",
      "directNextRequest", "directReceiveSnapshot", "directReceiveStatus", "directRefreshStart",
      "directSessionStart", "publicCard", "signCardPublicationAssertion", "signLoginAssertion",
    ].sort());
    account.directSessionStart("mainnet", "https://wallet.example.test", raw("01".repeat(16)), raw("02".repeat(32)), 4n, 4n, 7n);
    account.directConfigure(raw("b676d61cabef82d1837ffe0f0c69a2002bedb7bd371c1c0b6654dffd2618070be9dfe22640c6c399b2ac22"), new Uint8Array());
    assert.equal(account.directReceiveStatus(), 0);
    assert.equal(account.directNextRequest(1), "02".repeat(32));
    assert.throws(() => account.directReceiveSnapshot());
    account.close();
    assert.throws(() => account.directReceiveStatus());
    console.log(JSON.stringify({bounded:true,closed:true}));
  `),
  ).toEqual({ bounded: true, closed: true });
});
