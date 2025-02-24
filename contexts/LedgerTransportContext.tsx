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
      let connectedTransport: Transport | null =
        await TransportWebHid.openConnected();
      if (!connectedTransport) {
        connectedTransport = await TransportWebHid.create();
      }

      // Check if Kaspa app is open
      if (await checkKaspaAppOpen(connectedTransport)) {
        setIsAppOpen(true);
      }

      // Check if Kaspa app is open every 5 seconds
      const appOpenCheckInterval = setInterval(async () => {
        const isOpen = await checkKaspaAppOpen(connectedTransport);
        setIsAppOpen(isOpen);
      }, 5_000);

      setIsAppOpenCheckInterval(appOpenCheckInterval);
      setTransport(connectedTransport);

      connectedTransport.on("disconnect", () => {
        clearInterval(appOpenCheckInterval);
        setIsAppOpen(false);
        setTransport(null);
      });
    } catch (error) {
      captureException(error);
      console.error("Ledger connection error:", error);
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
