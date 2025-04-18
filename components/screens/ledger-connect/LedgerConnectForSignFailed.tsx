import Header from "@/components/GeneralHeader";
import ledgerConnectFailedImage from "@/assets/images/ledger-connect-error.png";

export default function LedgerConnectForSignFailed({
  showClose = true,
  retry,
  onClose,
}: {
  showClose?: boolean;
  retry: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="space-y-10">
        <Header
          title="Confirm on Ledger"
          onClose={onClose}
          showPrevious={false}
          showClose={showClose}
        />
        <div className="space-y-4">
          <img
            alt="ledger connect failed"
            className="mx-auto"
            src={ledgerConnectFailedImage}
          />
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">
              Oops! Ledger connection lost
            </h1>
            <p className="text-sm text-[#7b9aaa]">
              Please ensure your Ledger is connected and Kaspa app is open.
            </p>
          </div>
        </div>
      </div>
      <button
        onClick={retry}
        className="items-center rounded-full bg-icy-blue-400 py-4 text-base font-semibold transition-colors hover:bg-icy-blue-600"
      >
        Try Again
      </button>
    </div>
  );
}
