import { createContext, ReactNode, useCallback, useState } from "react";
import Transport from "@ledgerhq/hw-transport";
import TransportWebHid from "@ledgerhq/hw-transport-webhid";
import { captureException } from "@sentry/react";
import KaspaApp from "hw-app-kaspa";

interface LedgerTransportContextType {
  transport: Transport | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
  isAppOpen: boolean;
}

export const LedgerTransportContext = createContext<
  LedgerTransportContextType | undefined
>(undefined);

async function checkKaspaAppOpen(transport: Transport) {
  const kaspaApp = new KaspaApp(transport);
  try {
    await kaspaApp.getVersion();
    return true;
  } catch (error) {
    return false;
  }
}

export function LedgerTransportProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAppOpen, setIsAppOpen] = useState(false);
  const [isAppOpenCheckInterval, setIsAppOpenCheckInterval] =
    useState<NodeJS.Timeout | null>(null);

  const connect = async () => {
    if (isConnecting || transport) return;
    setIsConnecting(true);

    try {
      // Try to get existing connection
      let newTransport: Transport | null =
        await TransportWebHid.openConnected();
      if (!newTransport) {
        newTransport = await TransportWebHid.create();
      }

      // Check if Kaspa app is open
      if (await checkKaspaAppOpen(newTransport)) {
        setIsAppOpen(true);
      } else {
        const checkInterval = setInterval(async () => {
          if (await checkKaspaAppOpen(newTransport)) {
            setIsAppOpen(true);
            clearInterval(checkInterval);
          }
        }, 1000);
      }

      setTransport(newTransport);

      newTransport.on("disconnect", () => {
        console.log("Ledger device disconnected");
        newTransport?.close();
        setTransport(null);
        setIsAppOpen(false);
      });
    } catch (error) {
      captureException(error);
      throw new Error("Failed to connect to Ledger device");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = useCallback(async () => {
    if (transport) {
      try {
        setTransport(null);
      } catch (error) {
        captureException(error);
        console.error("Transport disconnection error:", error);
      }
    }

    if (isAppOpenCheckInterval) {
      clearInterval(isAppOpenCheckInterval);
    }
  }, [transport, isAppOpenCheckInterval]);

  return (
    <LedgerTransportContext.Provider
      value={{
        transport,
        connect,
        disconnect,
        isConnecting,
        isAppOpen,
      }}
    >
      {children}
    </LedgerTransportContext.Provider>
  );
}
