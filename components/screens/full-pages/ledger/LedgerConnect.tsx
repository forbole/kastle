import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useRef } from "react";
import Header from "@/components/GeneralHeader";

export default function LedgerConnect() {
  const { transport, connect, isAppOpen, isConnecting } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const calledOnce = useRef(false);

  const connectDevice = async () => {
    if (isConnecting) {
      return;
    }

    try {
      await connect();
    } catch (error) {
      navigate("/ledger-connect-failed?redirect=" + redirect);
    }
  };

  useEffect(() => {
    if (!redirect) {
      return;
    }

    if (transport && isAppOpen) {
      navigate(redirect);
      return;
    }

    if (!calledOnce.current && !transport) {
      connectDevice();
      calledOnce.current = true;
    }
  }, [transport, isAppOpen]);

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-center gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
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
