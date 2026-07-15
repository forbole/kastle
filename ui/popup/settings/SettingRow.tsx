export interface SettingRowProps {
  label: string;
  value?: string;
  /** Override the value text color (e.g. teal-500 for an active network). Defaults to white. */
  valueColor?: string;
  showChevron?: boolean;
  onClick?: () => void;
}

export default function SettingRow({
  label,
  value,
  valueColor = "text-white",
  showChevron = false,
  onClick,
}: SettingRowProps) {
  return (
    <button
      type="button"
      className="flex h-[62px] w-full items-center justify-between rounded-xl border border-daintree-700 bg-white/10 px-5"
      onClick={onClick}
    >
      <span className="shrink-0 text-sm font-semibold text-white">{label}</span>
      <div className="ml-4 flex min-w-0 items-center justify-end gap-2">
        {value && (
          <span className={`truncate text-sm font-semibold ${valueColor}`}>
            {value}
          </span>
        )}
        {showChevron && (
          <i className="hn hn-angle-right shrink-0 text-xl text-daintree-400" />
        )}
      </div>
    </button>
  );
}
