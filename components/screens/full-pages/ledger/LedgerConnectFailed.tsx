import Header from "@/components/GeneralHeader";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useNavigate } from "react-router-dom";

export default function LedgerConnectFailed() {
  const { disconnect } = useLedgerTransport();
  const navigate = useNavigate();

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-center gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <Header title="Connect Ledger" showClose={false} showPrevious={false} />

      <div>Failed to connect to Ledger device</div>

      <button
        onClick={async() => {
          await disconnect();
          navigate("/import-ledger");
        }}
        className="mt-auto inline-flex w-full justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
      >
        Try Again
      </button>
    </div>
  );
}
