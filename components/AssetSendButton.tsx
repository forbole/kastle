type Props = {
  /** Shown as "Send {ticker}". */
  ticker: string;
  onClick: () => void;
};

// The send action pinned to the bottom of every asset detail page. Place it as
// the last child of the page column, after the scrolling body. When the wallet
// cannot send the asset, do not render it: hide, do not disable. A long name
// is cut on one line, so the button has the same size on every page.
export default function AssetSendButton({ ticker, onClick }: Props) {
  return (
    <div className="flex shrink-0 flex-col pt-2">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex w-full items-center justify-center rounded-full border border-white px-4 py-[14px] text-[15px] font-semibold text-white"
      >
        <span className="min-w-0 truncate">{`Send ${ticker}`}</span>
      </button>
    </div>
  );
}
