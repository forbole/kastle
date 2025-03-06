import { createContext, ReactNode, useCallback, useState } from "react";
import Transport from "@ledgerhq/hw-transport";
import TransportWebHid from "@ledgerhq/hw-transport-webhid";
import { captureException } from "@sentry/react";
import KaspaApp from "hw-app-kaspa";
import toast from "@/components/Toast";

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

      setTransport(newTransport);

      // Check if Kaspa app is open
      try {
        if (await checkKaspaAppOpen(newTransport)) {
          setIsAppOpen(true);
        } else {
          await newTransport.send(
            0xe0,
            0xd8,
            0x00,
            0x00,
            Buffer.from("Kaspa", "ascii"),
          );
        }
      } catch (error) {
        toast.error(
          "Can not open Kaspa app on Ledger device, please check the ledger device and try again.",
        );
      }

      newTransport.on("disconnect", () => {
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
  }, [transport]);

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
