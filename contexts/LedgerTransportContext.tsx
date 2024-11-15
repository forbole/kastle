import { createContext, useState, useCallback, ReactNode } from "react";
import Transport from "@ledgerhq/hw-transport";
import TransportWebHid from "@ledgerhq/hw-transport-webhid";

interface LedgerTransportContextType {
  transport: Transport | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
}

export const LedgerTransportContext = createContext<
  LedgerTransportContextType | undefined
>(undefined);

export function LedgerTransportProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = async () => {
    if (isConnecting || transport) return;
    setIsConnecting(true);

    try {
      // Try to get existing connection
      const existingTransport = await TransportWebHid.openConnected();
      if (existingTransport) {
        setTransport(existingTransport);
        return;
      }

      // Create new connection if none exists
      const newTransport = await TransportWebHid.create();
      setTransport(newTransport);

      newTransport.on("disconnect", () => {
        setTransport(null);
        newTransport.close();
      });

      // detect app close
    } catch (error) {
      console.error("Ledger connection error:", error);
      throw new Error("Failed to connect to Ledger device");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = useCallback(async () => {
    if (transport) {
      try {
        await transport.close();
        setTransport(null);
      } catch (error) {
        console.error("Transport disconnection error:", error);
      }
    }
  }, [transport]);

  return (
    <LedgerTransportContext.Provider
      value={{
        transport,
        connect,
        disconnect,
        isConnecting,
      }}
    >
      {children}
    </LedgerTransportContext.Provider>
  );
}
