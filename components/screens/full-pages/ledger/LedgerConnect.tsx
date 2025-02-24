import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "@/components/GeneralHeader";
import { useEffect, useRef } from "react";

export default function LedgerConnect() {
  const { transport, connect } = useLedgerTransport();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get("redirect");
  const calledOnce = useRef(false);

  useEffect(() => {
    if (!redirect) {
      return;
    }

    if (transport) {
      navigate(redirect);
      return;
    }

    const connectDevice = async () => {
      try {
        await connect();
      } catch (error) {
        navigate("/ledger-connect-failed");
      }
    };

    if (!calledOnce.current && !transport) {
      connectDevice();
      calledOnce.current = true;
    }
  }, [transport]);

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-center gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <Header title="Connect Ledger" showClose={false} showPrevious={false} />
    </div>
  );
}
