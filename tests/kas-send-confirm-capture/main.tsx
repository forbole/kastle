import React from "react";
import ReactDOM from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { ConfirmStep } from "@/components/send/kas-send/ConfirmStep";

window.__kasConfirm = {
  scenario: new URLSearchParams(location.search).get("scenario") ?? "ok",
  captured: [],
  failed: [],
};

function Confirm() {
  const form = useForm({
    defaultValues: {
      address: "kaspa:qrecipient1",
      amount: "1",
      priorityFee: 0n,
    },
  });
  return (
    <FormProvider {...form}>
      <ConfirmStep
        onNext={() => {}}
        onBack={() => {}}
        onFail={(reason) => window.__kasConfirm.failed.push(reason)}
        setOutTxs={() => {}}
        walletSigner={
          { getAddress: async () => "kaspa:qowner" } as unknown as Parameters<
            typeof ConfirmStep
          >[0]["walletSigner"]
        }
      />
    </FormProvider>
  );
}

const router = createMemoryRouter([{ path: "/", element: <Confirm /> }]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
