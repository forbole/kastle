import SettingRow from "./SettingRow";

export interface CustomRpcSettingsSectionProps {
  /** e.g. "Mainnet" / "Testnet". */
  networkValue: string;
  /** "Default" or the active custom node's name. */
  customRpcValue: string;
  onNetworkClick?: () => void;
  onCustomRpcClick?: () => void;
}

export default function CustomRpcSettingsSection({
  networkValue,
  customRpcValue,
  onNetworkClick,
  onCustomRpcClick,
}: CustomRpcSettingsSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <SettingRow
        label="Custom RPC"
        value={customRpcValue}
        onClick={onCustomRpcClick}
      />
      <SettingRow
        label="Network"
        value={networkValue}
        valueColor="text-teal-500"
        onClick={onNetworkClick}
      />
    </div>
  );
}
