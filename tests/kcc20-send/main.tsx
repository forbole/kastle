import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { Kcc20TokenListItem } from "@/components/dashboard/TokenListItem";
import Kcc20Send from "@/components/send/kcc20-send/Kcc20Send";
import Kcc20Asset from "@/components/screens/Kcc20Asset";
import { Krc20Send } from "@/components/send/krc20-send/Krc20Send";
import Krc20Transfer from "@/components/send/krc20-send/Krc20Transfer";
import { SuccessStatus } from "@/components/send/SuccessStatus";
import { FailStatus } from "@/components/send/FailStatus";
import AssetSelect from "@/components/screens/asset-selector/AssetSelect";
import { kcc20Token } from "./stubs";

const params = new URLSearchParams(location.search);
window.__kcc20Send = {
  build: params.get("build") ?? "ok",
  send: params.get("send") ?? "ok",
  builds: [],
  recent: [],
};

// The shared status screens read the form to tell a KAS send from a KRC-20 op.
function Status({ kind }: { kind: "kas" | "krc20" }) {
  const form = useForm({
    defaultValues:
      kind === "krc20"
        ? { opData: { op: "transfer", tick: "KASPY", amt: "1", to: "x" } }
        : { amount: "1" },
  });
  return (
    <FormProvider {...form}>
      <SuccessStatus transactionIds={["tx1"]} />
      <FailStatus transactionIds={["tx1"]} />
    </FormProvider>
  );
}

const router = createMemoryRouter(
  [
    {
      path: "/dashboard",
      element: <Kcc20TokenListItem token={kcc20Token} />,
    },
    { path: "/kcc20/:covenantId", element: <Kcc20Asset /> },
    { path: "/kcc20/send/:covenantId", element: <Kcc20Send /> },
    { path: "/krc20/send/:tick", element: <Krc20Send /> },
    { path: "/token-transfer", element: <Krc20Transfer /> },
    { path: "/status/kas", element: <Status kind="kas" /> },
    { path: "/status/krc20", element: <Status kind="krc20" /> },
    { path: "/asset-select", element: <AssetSelect /> },
  ],
  {
    initialEntries: [
      {
        pathname: params.get("route") ?? "/dashboard",
        state: JSON.parse(params.get("state") ?? "null"),
      },
    ],
  },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <div id="popup" className="h-[600px] w-[375px]">
    <RouterProvider router={router} />
  </div>,
);
