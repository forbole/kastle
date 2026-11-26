// Tailwind so the confirm screen's layout matches the popup.
import "@/entrypoints/main.css";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import init from "@/wasm/core/kaspa";
import wasmUrl from "@/assets/kaspa_bg.wasm?url";
import repro from "@/test/fixtures/kaspacom-signtx-repro.txt?raw";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";

await init({ module_or_path: wasmUrl });

const params = new URLSearchParams(location.search);
window.__signHarness = { confirmed: 0, cancelled: 0, pieceCalls: [] };

// ?tx=v1: the kaspa.com repro (version 1). ?tx=v0: a version-0 spend of the
// same wallet input, so both screens read the same account.
const [, networkId, v1TxJson] = repro.match(
  /signTx\(\s*'([^']+)',\s*'(.*?)',/s,
)!;
const v1 = JSON.parse(v1TxJson);
const v0TxJson = JSON.stringify({
  ...v1,
  version: 0,
  inputs: [v1.inputs[2]],
  outputs: [v1.outputs[3]],
});

// ?tx=v1unknown: output 0 (bound to input 0) carries a script no address spells.
const v1UnknownTxJson = JSON.stringify({
  ...v1,
  outputs: v1.outputs.map((o: { scriptPublicKey: string }, i: number) =>
    i === 0 ? { ...o, scriptPublicKey: "00006a" } : o,
  ),
});

// ?tx=fee2000: the v0 spend paying a 2,000-sompi fee (0.00002 KAS).
const fee2000TxJson = JSON.stringify({
  ...v1,
  version: 0,
  inputs: [v1.inputs[2]],
  outputs: [
    {
      ...v1.outputs[3],
      value: String(BigInt(v1.inputs[2].utxo.amount) - 2000n),
    },
  ],
});

// ?tx=v0mixed: version 0, the repro's foreign covenant input (its P2SH, no
// covenant id) beside the wallet's own coin. ?tx=v0mixednofee drops input 1's
// UTXO entry (stubs.ts).
const foreignUtxo = { ...v1.inputs[1].utxo, covenantId: undefined };
const v0MixedTxJson = JSON.stringify({
  ...v1,
  version: 0,
  inputs: [{ ...v1.inputs[1], utxo: foreignUtxo }, v1.inputs[2]],
  outputs: [v1.outputs[3]],
});

// ?tx=v0presigned: v0mixed plus an own coin that arrives signed, at input 1.
const v0PresignedTxJson = JSON.stringify({
  ...JSON.parse(v0MixedTxJson),
  inputs: [
    JSON.parse(v0MixedTxJson).inputs[0],
    {
      ...v1.inputs[2],
      previousOutpoint: { ...v1.inputs[2].previousOutpoint, index: 7 },
      signatureScript: "52",
    },
    v1.inputs[2],
  ],
});

// ?pskt=1:All,2:AllAnyOneCanPay: a signPskt request listing those inputs.
const pskt = params.get("pskt");

const payload = {
  // ?network= overrides both the request and the settings network (stubs.ts).
  networkId: params.get("network") ?? networkId,
  txJson:
    {
      v0: v0TxJson,
      v1unknown: v1UnknownTxJson,
      fee2000: fee2000TxJson,
      v0mixed: v0MixedTxJson,
      v0mixednofee: v0MixedTxJson,
      v0presigned: v0PresignedTxJson,
      // ?tx=v1nofee: v1 with input 1's UTXO entry dropped (stubs.ts).
      v1nofee: v1TxJson,
    }[params.get("tx") ?? ""] ?? v1TxJson,
  // ?sign=<SignType>: one script option on the wallet input (index 2).
  scripts: pskt
    ? pskt.split(",").map((entry) => {
        const [index, signType] = entry.split(":");
        return { inputIndex: Number(index), signType: signType as "All" };
      })
    : params.get("sign")
      ? [{ inputIndex: 2, signType: params.get("sign") as "All" }]
      : [],
};

const router = createMemoryRouter([
  {
    path: "/",
    element: (
      <SignConfirm
        payload={payload}
        confirm={() => {
          window.__signHarness.confirmed++;
        }}
        cancel={() => {
          window.__signHarness.cancelled++;
        }}
        warning={params.get("warning") ?? undefined}
        psktRequest={pskt !== null}
      />
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div id="popup" className="h-[600px] w-[375px]">
    <RouterProvider router={router} />
  </div>,
);
