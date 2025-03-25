import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useEffect, useState } from "react";
import Header from "@/components/GeneralHeader";
import { twMerge } from "tailwind-merge";
import ledgerConnectingImage from "@/assets/images/ledger-connecting.png";
import LedgerConnectForImportFailed from "@/components/screens/full-pages/ledger/LedgerConnectForImportFailed";

export default function LedgerConnectForImport({
  onBack,
}: {
  onBack?: () => void;
}) {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [showConnect, setShowConnect] = useState(true);
  const [isPreviousConnected, setIsPreviousConnected] = useState(false);
  const [isError, setIsError] = useState(false);

  const connectDevice = async () => {
    if (isConnecting) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      setIsError(true);
    }
  };

  const tryConnect = () => {
    setShowConnect(false);
    connectDevice();
    setTimeout(() => {
      setShowConnect(true);
    }, 1000); // Show retry button after 1 seconds
  };

  useEffect(() => {
    return () => {
      setIsPreviousConnected(!!transport);
    };
  }, [transport]);

  const isLedgerConnected = !!transport || isPreviousConnected;

  const errorRetry = () => {
    setIsError(false);
  };

  return (
    <>
      {isError && <LedgerConnectForImportFailed retry={errorRetry} />}

      {!isError && (
        <div className="flex h-[39rem] w-[41rem] flex-col items-stretch justify-between rounded-3xl bg-icy-blue-950 p-4 pb-6">
          <div className="space-y-4">
            <Header
              title="Connect Ledger"
              showClose={false}
              showPrevious={true}
              onBack={onBack}
            />

            <div className="space-y-10">
              <div className="space-y-2">
                <img
                  alt="ledger connecting"
                  className="mx-auto"
                  width="340"
                  height="130"
                  src={ledgerConnectingImage}
                />
                <div className="space-y-2 text-center">
                  <h1 className="text-xl font-semibold">
                    Please connect your Ledger device and open Kaspa app
                  </h1>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-4 text-xs">
                <div
                  className={twMerge(
                    "flex items-center gap-2 rounded-md p-2",
                    isLedgerConnected
                      ? "bg-[#115E59] bg-opacity-30 text-[#14B8A6]"
                      : "bg-[#122932]",
                  )}
                >
                  {isLedgerConnected ? (
                    <i className="hn hn-check-circle text-xs text-[#14B8A6]"></i>
                  ) : (
                    <div
                      className="inline-block size-3 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                      role="status"
                      aria-label="loading"
                    />
                  )}
                  Connect Ledger
                </div>

                <div
                  className={twMerge(
                    "flex items-center gap-2 rounded-md p-2",
                    isAppOpen
                      ? "bg-[#115E59] bg-opacity-30 text-[#14B8A6]"
                      : "bg-[#122932]",
                  )}
                >
                  {isAppOpen ? (
                    <i className="hn hn-check-circle text-xs text-[#14B8A6]"></i>
                  ) : (
                    <div
                      className="inline-block size-3 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                      role="status"
                      aria-label="loading"
                    />
                  )}
                  Open Kaspa app
                </div>
              </div>
            </div>
          </div>

          {showConnect && (
            <button
              onClick={tryConnect}
              className="items-center rounded-full bg-icy-blue-400 p-5 text-base hover:bg-icy-blue-600"
            >
              {!isLedgerConnected && "Connect"}
              {isLedgerConnected && !isAppOpen && "I've opened the app"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
