import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import Header from "@/components/GeneralHeader";
import ledgerConnectingImage from "@/assets/images/ledger-connecting.png";
import { twMerge } from "tailwind-merge";

export default function LedgerConnectForSign({
  showPrevious = true,
  showClose = true,
}: {
  showPrevious?: boolean;
  showClose?: boolean;
}) {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const state = searchParams.get("state");
  const [showConnect, setShowConnect] = useState(true);
  const [isPreviousConnected, setIsPreviousConnected] = useState(false);

  const redirectBack = useCallback(() => {
    if (!redirect) {
      return;
    }

    const [pathname, search] = redirect.split("?");
    navigate(
      {
        pathname: pathname,
        search: search,
      },
      {
        state: state ? JSON.parse(decodeURIComponent(state)) : undefined,
      },
    );
  }, [redirect, state]);

  const connectDevice = async () => {
    // Do nothing if the connection is in progress
    if (isConnecting) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      navigate({
        pathname: "/ledger-connect-for-sign-failed",
        search: `?redirect=${redirect}&state=${state}`,
      });
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
    // Redirect to the page if the connection is successful
    if (transport && isAppOpen) {
      redirectBack();
      return;
    }
  }, [transport, isAppOpen, redirectBack]);

  const isLedgerConnected = !!transport || isPreviousConnected;

  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-10">
        <Header
          title="Connect Ledger"
          showPrevious={showPrevious}
          showClose={showClose}
          onBack={redirectBack}
          onClose={() => navigate("/dashboard")}
        />
        <div className="space-y-4">
          <img
            alt="ledger connecting"
            className="mx-auto"
            src={ledgerConnectingImage}
          />
          <div className="space-y-10 text-center">
            <h1 className="text-xl font-semibold">
              Please connect your Ledger device and open Kaspa app
            </h1>

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
      </div>
      {showConnect && (
        <button
          onClick={tryConnect}
          className="items-center rounded-full bg-icy-blue-400 py-4 text-base font-semibold transition-colors hover:bg-icy-blue-600"
        >
          {!isLedgerConnected && "Connect"}
          {isLedgerConnected && !isAppOpen && "I've opened the app"}
        </button>
      )}
    </div>
  );
}
