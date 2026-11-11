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

const payload = {
  // ?network= overrides both the request and the settings network (stubs.ts).
  networkId: params.get("network") ?? networkId,
  txJson:
    { v0: v0TxJson, v1unknown: v1UnknownTxJson }[params.get("tx") ?? ""] ??
    v1TxJson,
  // ?sign=<SignType>: one script option on the wallet input (index 2).
  scripts: params.get("sign")
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
      />
    ),
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div id="popup" className="h-[600px] w-[375px]">
    <RouterProvider router={router} />
  </div>,
);
