import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import Header from "@/components/GeneralHeader";
import ledgerConnectingImage from "@/assets/images/ledger-connecting.png";
import { twMerge } from "tailwind-merge";

export default function LedgerConnectForSign() {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const state = searchParams.get("state");
  const calledConnectOnce = useRef(false);
  const callCheckNeedRetryOnce = useRef(false);
  const [showRetry, setShowRetry] = useState(false);

  const redirectBack = useCallback(() => {
    if (!redirect) {
      return;
    }

    navigate(
      {
        pathname: redirect,
      },
      {
        state: JSON.parse(decodeURIComponent(state ?? "") ?? "{}"),
      },
    );
  }, [redirect, state]);

  const connectDevice = async () => {
    // Do nothing if the connection is in progress
    if (isConnecting || !redirect) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      console.log(error);
      setTimeout(
        () =>
          navigate({
            pathname: "/ledger-connect-for-sign-failed",
            search: `?redirect=${redirect}&state=${state}`,
          }),
        1000, // Delay to prevent the page from flickering
      );
    }
  };

  const retry = () => {
    setShowRetry(false);
    connectDevice();
    setTimeout(() => {
      setShowRetry(true);
    }, 1000); // Show retry button after 1 seconds
  };

  useEffect(() => {
    if (!calledConnectOnce.current) {
      calledConnectOnce.current = true;
      return;
    }

    if (!transport) {
      connectDevice();
    }
  }, [transport, isAppOpen, isConnecting]);

  useEffect(() => {
    // Redirect to the page if the connection is successful
    if (transport && isAppOpen) {
      setTimeout(redirectBack, 2000); // Delay to prevent the page from flickering
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
    }, 1000); // Wait for the first attempt to connect
    return () => clearTimeout(timeout);
  }, [transport, isAppOpen, redirectBack]);

  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-10">
        <Header
          title="Connect Ledger"
          onBack={redirectBack}
          onClose={() => navigate("/dashboard")}
        />
        <div className="space-y-4">
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
          className="items-center rounded-full bg-icy-blue-400 py-4 text-base font-semibold transition-colors hover:bg-icy-blue-600"
        >
          Retry
        </button>
      )}
    </div>
  );
}
