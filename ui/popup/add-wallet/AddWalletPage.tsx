import PageHeader from "@/ui/general/PageHeader";

export interface WalletOption {
  label: string;
  description: string;
  onClick?: () => void;
}

export interface AddWalletPageProps {
  options?: WalletOption[];
  advancedOptions?: WalletOption[];
  onBack?: () => void;
  onClose?: () => void;
}

function OptionButton({ label, description, onClick }: WalletOption) {
  return (
    <button
      className="flex w-full items-start gap-2.5 rounded-xl border border-daintree-700 bg-white/10 p-4 text-left hover:border-daintree-400"
      onClick={onClick}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold leading-normal text-white">
          {label}
        </span>
        <span className="text-[12px] font-normal leading-4 text-daintree-400">
          {description}
        </span>
      </div>
      <i className="hn hn-arrow-right mt-0.5 size-[14px] shrink-0 text-[14px] text-gray-200" />
    </button>
  );
}

const DEFAULT_OPTIONS: WalletOption[] = [
  {
    label: "Create new wallet",
    description: "Create a 12-word recovery phrase",
  },
  {
    label: "Import Recovery phrase",
    description: "Use a 12- or 24-word recovery phrase",
  },
  {
    label: "Import Private Key",
    description: "Use a private key.",
  },
  {
    label: "Import Ledger",
    description: "Connect a Ledger device via USB",
  },
];

const DEFAULT_ADVANCED_OPTIONS: WalletOption[] = [
  {
    label: "Import Recovery phrase with passphrase",
    description:
      "Advanced. Only if you set a passphrase when creating your wallet.",
  },
];

export default function AddWalletPage({
  options = DEFAULT_OPTIONS,
  advancedOptions = DEFAULT_ADVANCED_OPTIONS,
  onBack,
  onClose,
}: AddWalletPageProps) {
  return (
    <div className="flex h-full flex-col bg-icy-blue-950 text-white">
      <PageHeader
        title="Create / Import Wallet"
        showBack
        showClose
        onBack={onBack}
        onClose={onClose}
      />

      <div className="flex flex-col gap-2 px-4">
        {options.map((opt) => (
          <OptionButton key={opt.label} {...opt} />
        ))}

        {advancedOptions.length > 0 && (
          <>
            <p className="px-2 pt-3 text-sm font-semibold leading-5 tracking-[0.07px] text-daintree-400">
              Advanced
            </p>
            {advancedOptions.map((opt) => (
              <OptionButton key={opt.label} {...opt} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
