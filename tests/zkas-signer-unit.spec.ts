import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const signerDir = path.join(root, "wasm/zkas-signer");
const signerBytes = path.join(signerDir, "firecash_signer_bg.wasm");
const signerSha =
  "89e75959878d113154212fa901e6599b21d4a3823ac12fbd92287d4be6a23914";
const mainnetGenesis =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("bundled signer is the pinned ZKas mainnet build", () => {
  const bytes = fs.readFileSync(signerBytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(signerSha);
  expect(bytes.includes(Buffer.from(mainnetGenesis, "hex"))).toBe(true);
});

test("the signer derives separate recoverable shielded accounts", async () => {
  const script = `
    import fs from "node:fs";
    import init,{account_seed_hex,account_address,address_from_seed} from "./wasm/zkas-signer/firecash_signer.js";
    await init({module_or_path:fs.readFileSync("wasm/zkas-signer/firecash_signer_bg.wasm")});
    const phrase = ${JSON.stringify(phrase)};
    const first = account_seed_hex(phrase,0);
    console.log(JSON.stringify({
      first,
      second:account_seed_hex(phrase,1),
      mainnet:account_address(phrase,"mainnet",0),
      testnet:account_address(phrase,"testnet",0),
      restored:address_from_seed(first,"mainnet")
    }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: root,
      timeout: 10_000,
      encoding: "utf8",
    },
  );
  const result = JSON.parse(output);
  expect(result.first).toBe(
    "20468ca002014b860fce6926a03c8eeaceebb48b365160f60836cc3a111d3b38",
  );
  expect(result.second).not.toBe(result.first);
  expect(result.mainnet).toBe(
    "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy",
  );
  expect(result.restored).toBe(result.mainnet);
  expect(result.testnet.startsWith("zkastest:")).toBe(true);
});

test("the pinned signer refuses testnet payment authorization", () => {
  const script = `
    import fs from "node:fs";
    import init,{account_seed_hex,address_from_seed,verify_and_sign_payment} from "./wasm/zkas-signer/firecash_signer.js";
    await init({module_or_path:fs.readFileSync("wasm/zkas-signer/firecash_signer_bg.wasm")});
    const seed = account_seed_hex(${JSON.stringify(phrase)},0);
    const to = address_from_seed(seed,"testnet");
    try { verify_and_sign_payment(seed,"testnet",to,100n,20n,"ab","[]","[]"); }
    catch (error) { console.log(String(error)); }
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: root,
      timeout: 10_000,
      encoding: "utf8",
    },
  );
  expect(output).toMatch(/only mainnet is pinned/);
});

test("the shipped WASM binds the reviewed memo to the encrypted recipient note", () => {
  // Synthetic, proof-free bundle: tests the check before any real payment can be signed.
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(root, "tests/fixtures/zkas-memo-prepared.json"),
      "utf8",
    ),
  );
  const script = `
    import fs from "node:fs";
    import init,{verify_and_sign_payment_with_memo} from "./wasm/zkas-signer/firecash_signer.js";
    await init({module_or_path:fs.readFileSync("wasm/zkas-signer/firecash_signer_bg.wasm")});
    const fixture = ${JSON.stringify(fixture)};
    const spendAuth = JSON.stringify([{index:0,alpha:"03".repeat(32)}]);
    const sign = (memo) => verify_and_sign_payment_with_memo(
      fixture.seed,"mainnet",fixture.to,BigInt(fixture.amountSompi),
      BigInt(fixture.maxFeeSompi),memo,fixture.bundleHex,
      fixture.disclosure,spendAuth,
    );
    const rejects = (memo) => { try { sign(memo); return false; } catch { return true; } };
    console.log(JSON.stringify({
      signatures:JSON.parse(sign(fixture.memo)),
      changed:rejects("deposit 43"),
      omitted:rejects(""),
      oversized:rejects("a".repeat(513)),
    }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: root,
      timeout: 10_000,
      encoding: "utf8",
    },
  );
  expect(JSON.parse(output)).toEqual({
    signatures: [{ index: 0, sig: expect.stringMatching(/^[0-9a-f]{128}$/) }],
    changed: true,
    omitted: true,
    oversized: true,
  });
});

test("Kastle's signer adapter keeps spending material out of public account data", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kastle-zkas-signer-"));
  const adapterPath = path.join(tempDir, "signer.mjs");
  execFileSync(
    path.join(root, "node_modules/.bin/esbuild"),
    [
      path.join(root, "lib/zkas/signer.ts"),
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${adapterPath}`,
    ],
    { cwd: root, timeout: 10_000 },
  );
  const script = `
    import fs from "node:fs";
    import {initZKasSigner,deriveZKasAccount} from ${JSON.stringify(adapterPath)};
    let rejectedUnpinned = false;
    try { await initZKasSigner(new Uint8Array([0])); }
    catch (error) { rejectedUnpinned = String(error).includes("does not match the pinned version"); }
    await initZKasSigner(fs.readFileSync("wasm/zkas-signer/firecash_signer_bg.wasm"));
    const phrase = ${JSON.stringify(phrase)};
    const first = await deriveZKasAccount(phrase,0,"mainnet");
    const second = await deriveZKasAccount(phrase,0,"testnet");
    console.log(JSON.stringify({
      address:first.address, token:first.token, otherToken:second.token,
      rejectedUnpinned,
      publicFields:Object.keys(first).filter((key)=>key!=="signer"),
      fvk:await first.signer.fullViewingKeyHex()
    }));
  `;
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: root,
        timeout: 10_000,
        encoding: "utf8",
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const result = JSON.parse(output);
  expect(result.address).toBe(
    "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy",
  );
  expect(result.rejectedUnpinned).toBe(true);
  expect(result.token).toMatch(/^[0-9a-f]{32}$/);
  expect(result.otherToken).not.toBe(result.token);
  expect(result.publicFields).toEqual(["address", "token"]);
  expect(result.fvk).toMatch(/^[0-9a-f]{192}$/);
});

test("a raw ZKas seed restores the same address as the upstream signer", () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "kastle-zkas-raw-seed-"),
  );
  const adapterPath = path.join(tempDir, "signer.mjs");
  execFileSync(
    path.join(root, "node_modules/.bin/esbuild"),
    [
      path.join(root, "lib/zkas/signer.ts"),
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${adapterPath}`,
    ],
    { cwd: root, timeout: 10_000 },
  );
  const script = `
    import fs from "node:fs";
    import {initZKasSigner,deriveZKasAccountFromSeed} from ${JSON.stringify(adapterPath)};
    await initZKasSigner(fs.readFileSync("wasm/zkas-signer/firecash_signer_bg.wasm"));
    const account = await deriveZKasAccountFromSeed("20468ca002014b860fce6926a03c8eeaceebb48b365160f60836cc3a111d3b38", "mainnet");
    console.log(JSON.stringify({address:account.address,token:account.token}));
  `;
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: root,
        timeout: 10_000,
        encoding: "utf8",
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const result = JSON.parse(output);
  expect(result.address).toBe(
    "zkas:px8dx79gspafw49lw989mzdxhlqt6pehw9ql54r8ayyymv59vday3mtyxm432g4t6we2gygp3udqluy",
  );
  expect(result.token).toMatch(/^[0-9a-f]{32}$/);
});
