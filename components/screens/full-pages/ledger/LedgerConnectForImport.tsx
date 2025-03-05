import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import Header from "@/components/GeneralHeader";
import { twMerge } from "tailwind-merge";
import ledgerConnectingImage from "@/assets/images/ledger-connecting.png";

export default function LedgerConnectForImport() {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const [showConnect, setShowConnect] = useState(true);
  const [isPreviousConnected, setIsPreviousConnected] = useState(false);

  const connectDevice = async () => {
    if (isConnecting) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      navigate("/ledger-connect-for-import-failed?redirect=" + redirect);
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

  useEffect(() => {
    if (!redirect) {
      return;
    }

    if (transport && isAppOpen) {
      navigate(redirect);
      return;
    }
  }, [transport, isAppOpen]);

  const isLedgerConnected = !!transport || isPreviousConnected;

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-stretch justify-between rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="space-y-4">
        <Header title="Connect Ledger" showClose={false} showPrevious={false} />

        <div className="space-y-10">
          <div className="space-y-2">
            <img
              alt="ledger connecting"
              className="mx-auto"
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
                  className="border-3 inline-block size-3 animate-spin rounded-full border-current border-t-transparent text-blue-600 dark:text-blue-500"
                  role="status"
                  aria-label="loading"
                >
                  <span className="sr-only">Loading...</span>
                </div>
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
                  className="border-3 inline-block size-3 animate-spin rounded-full border-current border-t-transparent text-blue-600 dark:text-blue-500"
                  role="status"
                  aria-label="loading"
                >
                  <span className="sr-only">Loading...</span>
                </div>
              )}
              Open Kaspa app
            </div>
          </div>
        </div>
      </div>

      {showConnect && (
        <button
          onClick={tryConnect}
          className="items-center rounded-full bg-icy-blue-400 p-5 text-base font-semibold hover:bg-icy-blue-600"
        >
          Try Connect
        </button>
      )}
    </div>
  );
}
