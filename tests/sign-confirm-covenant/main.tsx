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

const payload = {
  networkId,
  txJson: params.get("tx") === "v0" ? v0TxJson : v1TxJson,
  scripts: [],
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
