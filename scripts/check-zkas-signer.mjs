import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const dir = new URL("../wasm/zkas-signer/", import.meta.url);
const wasm = readFileSync(new URL("firecash_signer_bg.wasm", dir));
const glue = readFileSync(new URL("firecash_signer.js", dir), "utf8");
const expectedHash =
  "ea0ec55a2cef0bb7f3cd6ce80b0e5c218693e0e97be49c80a73587b1eefcd409";
const expectedGlueHash =
  "95df21bdeab1d9ff56c2bf1a7dc8d733435dceeff0bd83ae60aa39f88d3f08db";
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
if (actualGlueHash !== expectedGlueHash) fail(`JS glue SHA-256 mismatch: ${actualGlueHash}`);
if (!wasm.includes(genesis)) fail("mainnet genesis domain is absent");

const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
const missing = imports
  .filter((entry) => entry.module === "wbg")
  .filter((entry) => !glue.includes(`imports.wbg.${entry.name}`));
if (missing.length > 0) {
  fail(`JS glue is missing ${missing.map((entry) => entry.name).join(", ")}`);
}

console.log(`ZKas signer OK: ${actualHash.slice(0, 12)}, genesis and glue verified`);
