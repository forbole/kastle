import { RouterProvider } from "react-router-dom";
import { router } from "@/entrypoints/popup/router.tsx";
import { LedgerTransportProvider } from "@/contexts/LedgerTransportContext.tsx";

export default function App() {
  return (
    <>
      {/* LedgerTransportProvider must be outside of RouterProvider, otherwise the ledger connection will be reset on every route change */}
      <LedgerTransportProvider>
        <RouterProvider router={router} />
      </LedgerTransportProvider>
    </>
  );
}
