import ledgerOnConfirmImage from "@/assets/images/ledger-on-confirm.png";
import Header from "@/components/GeneralHeader";

export default function LedgerConfirm({
  showPrevious = true,
  showClose = true,
  onBack,
  onClose,
}: {
  showPrevious?: boolean;
  showClose?: boolean;
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="space-y-10">
        <Header
          title="Confirm on Ledger"
          showPrevious={showPrevious}
          showClose={showClose}
          onBack={onBack}
          onClose={onClose}
        />
        <div className="space-y-4">
          <img
            alt="ledger on confirm"
            className="mx-auto"
            src={ledgerOnConfirmImage}
          />
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">
              Sign the transaction on your Ledger
            </h1>
          </div>
        </div>
      </div>
    </>
  );
}
