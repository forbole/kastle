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
  const calledConnectOnce = useRef(false);
  const callCheckNeedRetryOnce = useRef(false);
  const [showRetry, setShowRetry] = useState(false);

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

  const retry = () => {
    setShowRetry(false);
    connectDevice();
    setTimeout(() => {
      setShowRetry(true);
    }, 2000); // Show retry button after 2 seconds
  };

  useEffect(() => {
    if (!calledConnectOnce.current) {
      calledConnectOnce.current = true;
      return;
    }

    if (!transport) {
      connectDevice();
    }
  }, [transport]);

  useEffect(() => {
    if (!redirect) {
      return;
    }

    if (transport && isAppOpen) {
      setTimeout(() => {
        navigate(redirect);
      }, 1000); // Delay to prevent the page from flickering
      return;
    }

    if (!callCheckNeedRetryOnce.current) {
      callCheckNeedRetryOnce.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      if (!transport || !isAppOpen) {
        setShowRetry(true);
      }
    }, 500); // Wait for the first attempt to connect
    return () => clearTimeout(timeout);
  }, [transport, isAppOpen]);

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-stretch justify-between rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="space-y-4">
        <Header title="Connect Ledger" showClose={false} showPrevious={false} />

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
            <p className="text-sm text-[#7b9aaa]"> Waiting for connection...</p>

            <div className="flex justify-center gap-4 text-center text-sm">
              <div className="flex items-center gap-1">
                <i
                  className={twMerge(
                    "hn text-sm",
                    transport
                      ? "hn-check-circle text-green-200"
                      : "hn-exclamation-triangle text-red-400",
                  )}
                ></i>
                Ledger connected
              </div>

              <div className="flex items-center gap-1">
                <i
                  className={twMerge(
                    "hn text-sm",
                    isAppOpen
                      ? "hn-check-circle text-green-200"
                      : "hn-exclamation-triangle text-red-400",
                  )}
                ></i>
                Kaspa app open
              </div>
            </div>
          </div>
        </div>
      </div>

      {showRetry && (
        <button
          onClick={retry}
          className="items-center rounded-full bg-icy-blue-400 p-5 text-base font-semibold hover:bg-icy-blue-600"
        >
          Retry
        </button>
      )}
    </div>
  );
}
