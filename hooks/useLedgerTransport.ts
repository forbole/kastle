import { useContext } from "react";
import { LedgerTransportContext } from "@/contexts/LedgerTransportContext";

export default function useLedgerTransport() {
  const context = useContext(LedgerTransportContext);
  if (context === undefined) {
    throw new Error(
      "useLedgerTransport must be used within a TransportProvider",
    );
  }
  return context;
}
