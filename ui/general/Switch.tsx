type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the switch has no visible text of its own. */
  label: string;
  disabled?: boolean;
};

/** On/off switch: a button with role="switch", toggled by click, Space or Enter. */
export default function Switch({
  checked,
  onChange,
  label,
  disabled,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-icy-blue-400 bg-icy-blue-400 hover:bg-icy-blue-600"
          : "border-daintree-700 bg-daintree-700 hover:border-white"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-4 rounded-full bg-white transition-transform ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
