import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const dir = new URL("../wasm/zkas-batch/", import.meta.url);
const expected = {
  "zkas_browser_signer.js":
    "d666299a34d206e9f72d9b96ea18a9cdb815fe35198e26823a510c4543a731b6",
  "zkas_browser_signer.d.ts":
    "bef19c4fe8d433cbc123ca3ba1662b5f331561d63b313ee2e8fe16f5aab98676",
  "zkas_browser_signer_bg.wasm":
    "390de75c80ea88159e6f47f8e5747bf3d75a504106beb2b99d2a3605c5885261",
  "zkas_browser_signer_bg.wasm.d.ts":
    "8fb86485f60f72cb1d4980c3eda3152e7bc2c04f5805d410ada590f96e85a3d6",
};
for (const [name, pinned] of Object.entries(expected)) {
  const actual = createHash("sha256")
    .update(readFileSync(new URL(name, dir)))
    .digest("hex");
  if (actual !== pinned)
    throw new Error(`Private batch SDK ${name} differs from pinned release`);
}
const glue = readFileSync(new URL("zkas_browser_signer.js", dir), "utf8");
for (const method of [
  "approved_account",
  "sign_prepared_v3",
  "export_signed_v3_ticket",
  "import_signed_v3_ticket",
  "verify_finalized_v3",
]) {
  if (!glue.includes(`${method}(`))
    throw new Error(`Private batch SDK ${method} export is missing`);
}
const wasm = readFileSync(new URL("zkas_browser_signer_bg.wasm", dir));
const missing = WebAssembly.Module.imports(new WebAssembly.Module(wasm))
  .filter((entry) => entry.module === "wbg")
  .filter((entry) => !glue.includes(`imports.wbg.${entry.name}`));
if (missing.length)
  throw new Error(
    "Private batch SDK JS glue does not satisfy pinned WASM imports",
  );
console.log("Private batch SDK release pins and glue verified");
