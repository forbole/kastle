type Props = {
  /** Shown as "Send {ticker}". */
  ticker: string;
  disabled?: boolean;
  onClick: () => void;
};

// The send action pinned to the bottom of every asset detail page. Place it as
// the last child of the page column, after the scrolling body.
export default function AssetSendButton({ ticker, disabled, onClick }: Props) {
  return (
    <div className="flex shrink-0 flex-col pt-2">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="inline-flex w-full items-center justify-center rounded-full border border-white px-4 py-[14px] text-[15px] font-semibold text-white disabled:border-[#093446] disabled:text-[#083344]"
      >
        {`Send ${ticker}`}
      </button>
    </div>
  );
}
