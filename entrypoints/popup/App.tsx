import { RouterProvider } from "react-router-dom";
import { router } from "@/entrypoints/popup/router.tsx";
import { LedgerTransportProvider } from "@/contexts/LedgerTransportContext.tsx";

export default function App() {
  return (
    <LedgerTransportProvider>
      <RouterProvider router={router} />
    </LedgerTransportProvider>
  );
}
