import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import Header from "@/components/GeneralHeader";

export default function LedgerConnectForSign() {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const calledOnce = useRef(false);

  const connectDevice = async () => {
    // Do nothing if the connection is in progress
    if (isConnecting || !redirect) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      navigate("/ledger-connect-for-sign-failed?redirect=" + encodeURIComponent(redirect));
    }
  };

  useEffect(() => {
    if (!redirect) {
      return;
    }

    // Redirect to the page if the connection is successful
    if (transport && isAppOpen) {
      navigate(redirect);
      return;
    }

    if (!calledOnce.current && !transport) {
      connectDevice();
      calledOnce.current = true;
    }
  }, [transport, isAppOpen, isConnecting]);

  return (
    <div>
      <Header title="Connect Ledger" showClose={false} showPrevious={false} />
      <div>Please connect your Ledger device and open Kaspa app</div>

      {transport ? (
        <div>Ledger connected</div>
      ) : (
        <div>Ledger not connected</div>
      )}
      {isAppOpen ? <div>Kaspa app open</div> : <div>Kaspa app not open</div>}

      <button
        onClick={connectDevice}
        className="flex items-center gap-2 rounded-full bg-icy-blue-400 p-5 hover:bg-icy-blue-600"
      >
        Retry
      </button>
    </div>
  );
}
