import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const dir = new URL("../wasm/zkas-signer/", import.meta.url);
const wasm = readFileSync(new URL("firecash_signer_bg.wasm", dir));
const glue = readFileSync(new URL("firecash_signer.js", dir), "utf8");
const expectedHash =
  "89e75959878d113154212fa901e6599b21d4a3823ac12fbd92287d4be6a23914";
const expectedGlueHash =
  "eb096ca6c0433f80535042fec69d532f67f9555b7c41d5b557b3f035cf626b14";
const genesis = Buffer.from(
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f",
  "hex",
);

function fail(message) {
  throw new Error(`ZKas signer verification failed: ${message}`);
}

const actualHash = createHash("sha256").update(wasm).digest("hex");
if (actualHash !== expectedHash) fail(`SHA-256 mismatch: ${actualHash}`);
const actualGlueHash = createHash("sha256").update(glue).digest("hex");
if (actualGlueHash !== expectedGlueHash)
  fail(`JS glue SHA-256 mismatch: ${actualGlueHash}`);
if (!wasm.includes(genesis)) fail("mainnet genesis domain is absent");
if (!glue.includes("export function verify_and_sign_payment_with_memo(")) {
  fail("memo-aware signing export is missing");
}

const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
const missing = imports
  .filter((entry) => entry.module === "wbg")
  .filter((entry) => !glue.includes(`imports.wbg.${entry.name}`));
if (missing.length > 0) {
  fail(`JS glue is missing ${missing.map((entry) => entry.name).join(", ")}`);
}

console.log(
  `ZKas signer OK: ${actualHash.slice(0, 12)}, genesis and glue verified`,
);
