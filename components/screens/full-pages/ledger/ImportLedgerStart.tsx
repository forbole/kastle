import Header from "@/components/GeneralHeader";
import { useNavigate } from "react-router-dom";

export default function ImportLedgerStart() {
  const navigate = useNavigate();

  const steps = [
    "Connect & Unlock Ledger",
    "Open Kaspa app",
    "Import accounts",
    "Done! 🎉",
  ];

  return (
    <div className="flex h-[39rem] w-[41rem] flex-col items-center gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <Header
        title="Connect Ledger"
        subtitle="Just 3 simple steps to finish!"
        showClose={false}
        showPrevious={false}
      />

      <div className="mt-10 flex w-[20rem] flex-col gap-8 rounded-xl border border-[#203C49] p-10 text-xs">
        {steps.map((step, index) => (
          <div key={index} className="flex items-center gap-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#203C49]">
              {index === steps.length - 1 ? (
                <i className="hn hn-check text-white" />
              ) : (
                index + 1
              )}
            </div>
            <span className="text-base">{step}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate("/import-ledger")}
        className="mt-auto inline-flex w-full justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
      >
        Get Started
      </button>
    </div>
  );
}
