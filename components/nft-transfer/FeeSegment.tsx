import { Tooltip } from "react-tooltip";
import { twMerge } from "tailwind-merge";

type FeeSegmentProps = {
  feeTooltipText: string;
  estimatedFeeTooltipText: string;
  estimatedFee: string;
};

export default function FeeSegment({
  feeTooltipText,
  estimatedFeeTooltipText,
  estimatedFee,
}: FeeSegmentProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <button
        type="button"
        className={twMerge("relative flex cursor-default items-center gap-2")}
        disabled
      >
        <span>Fee</span>
        <i
          className={"hn hn-cog text-[16px] text-[#4B5563]"}
          data-tooltip-id="fee-tooltip"
          data-tooltip-content="Fees are handled automatically by Kastle."
        ></i>
        <Tooltip
          id="fee-tooltip"
          style={{
            backgroundColor: "#203C49",
            fontSize: "12px",
            fontWeight: 600,
            padding: "2px 8px",
          }}
          opacity={1}
        />
      </button>
      <div className="flex items-center gap-2">
        <Tooltip
          id="fee-estimation-tooltip"
          style={{
            backgroundColor: "#203C49",
            fontSize: "12px",
            fontWeight: 600,
            padding: "2px 8px",
          }}
          opacity={1}
        />
        <i
          className="hn hn-info-circle text-[16px]"
          data-tooltip-id="fee-estimation-tooltip"
          data-tooltip-content={estimatedFeeTooltipText}
        ></i>

        <span>Estimated</span>
        <span>{estimatedFee} KAS</span>
      </div>
    </div>
  );
}
