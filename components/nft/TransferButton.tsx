import { Tooltip } from "react-tooltip";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";

type TransferButtonProps = {
  disabledMessage?: string;
  redirectTo: string;
};

export default function TransferButton({
  disabledMessage,
  redirectTo,
}: TransferButtonProps) {
  const navigate = useNavigate();

  return (
    <div className="pb-4 pt-6 text-base font-semibold text-[#083344]">
      <>
        {disabledMessage && (
          <Tooltip
            id="transer-disabled"
            style={{
              backgroundColor: "#203C49",
              fontSize: "12px",
              fontWeight: 600,
              padding: "8px",
              width: "60%",
            }}
            opacity={1}
            place="top"
          />
        )}
        <button
          type="button"
          data-tooltip-id="transer-disabled"
          data-tooltip-content={disabledMessage}
          className="inline-flex w-full rounded-full border border-white py-3 text-white disabled:border-[#093446] disabled:text-[#083344]"
          disabled={disabledMessage !== undefined}
          onClick={() => navigate(redirectTo)}
        >
          <span className="ml-[120px]">Transfer</span>
          <div
            className={twMerge(
              "ml-2 rounded-full px-2 text-[10px]",
              !disabledMessage
                ? "bg-icy-blue-400 text-white"
                : "bg-[#164E63] bg-opacity-30 text-[#0E7490]",
            )}
          >
            New
          </div>
        </button>
      </>
    </div>
  );
}
