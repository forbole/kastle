import Header from "@/components/GeneralHeader";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import ledgerConnectErrorImage from "@/assets/images/ledger-connect-error.png";

export default function LedgerConnectForImportFailed({
  retry,
}: {
  retry: () => void;
}) {
  const { disconnect } = useLedgerTransport();

  const onRetry = async () => {
    await disconnect();
    retry();
  };

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-center gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="space-y-16">
        <Header title="Connect Ledger" showClose={false} showPrevious={false} />

        <div className="text-center">
          <img
            className="mx-auto"
            src={ledgerConnectErrorImage}
            alt="Ledger connect error"
          />
          <h3 className="text-xl font-semibold">
            Oops! Ledger connection lost
          </h3>
          <span className="text-sm text-[#7b9aaa]">
            Please ensure your Ledger is connected and the Kaspa app is open.
          </span>
        </div>
      </div>

      <button
        onClick={onRetry}
        className="mt-auto inline-flex w-full justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
      >
        Try Again
      </button>
    </div>
  );
}
