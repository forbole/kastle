import PageHeader from "@/ui/general/PageHeader";

export interface ImportMethod {
  label: string;
  description: string;
  onClick?: () => void;
}

export interface ImportWalletPageProps {
  title?: string;
  methods?: ImportMethod[];
  advancedMethods?: ImportMethod[];
  onBack?: () => void;
  onClose?: () => void;
  onCreateWallet?: () => void;
  createWalletLabel?: string;
}

function ChevronRight() {
  return (
    <svg
      className="shrink-0 text-gray-200"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 14 14"
      width="14"
    >
      <path d="M5 2l4.5 5L5 12" />
    </svg>
  );
}

function MethodButton({ label, description, onClick }: ImportMethod) {
  return (
    <button
      className="flex w-full items-start gap-2.5 rounded-xl border border-daintree-700 bg-white/10 px-5 py-[22px] text-left"
      onClick={onClick}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-[15px] font-semibold tracking-[0.075px] text-white">
          {label}
        </span>
        <span className="text-sm font-normal leading-5 tracking-[0.07px] text-daintree-400">
          {description}
        </span>
      </div>
      <ChevronRight />
    </button>
  );
}

const DEFAULT_METHODS: ImportMethod[] = [
  {
    label: "Recovery phrase",
    description: "Use a 12- or 24-word recovery phrase, or a private key.",
  },
  {
    label: "Private Key",
    description: "Use a private key.",
  },
  {
    label: "Ledger",
    description: "Connect a Ledger device via USB",
  },
];

const DEFAULT_ADVANCED_METHODS: ImportMethod[] = [
  {
    label: "Recovery phrase with passphrase",
    description:
      "Use this if you protected your wallet with an extra passphrase during setup.",
  },
];

export default function ImportWalletPage({
  title = "Import wallet with...",
  methods = DEFAULT_METHODS,
  advancedMethods = DEFAULT_ADVANCED_METHODS,
  onBack,
  onClose,
  onCreateWallet,
  createWalletLabel = "No wallet? Create one now",
}: ImportWalletPageProps) {
  return (
    <div className="flex h-full w-full items-start justify-center bg-icy-blue-900 py-10">
      <div className="flex w-[624px] flex-col overflow-clip rounded-3xl bg-icy-blue-950">
        <PageHeader
          onBack={onBack}
          onClose={onClose}
          showBack={true}
          showClose={false}
          title={title}
        />

        <div className="flex flex-col gap-10 px-10 pb-6">
          <div className="flex flex-col gap-4">
            {methods.map((m) => (
              <MethodButton key={m.label} {...m} />
            ))}

            {advancedMethods.length > 0 && (
              <>
                <div className="px-2 pt-3">
                  <span className="text-sm font-semibold leading-5 tracking-[0.07px] text-daintree-400">
                    Advanced
                  </span>
                </div>
                {advancedMethods.map((m) => (
                  <MethodButton key={m.label} {...m} />
                ))}
              </>
            )}
          </div>

          <div className="flex items-center justify-center py-6">
            <button
              className="text-[15px] font-semibold tracking-[0.075px] text-white"
              onClick={onCreateWallet}
            >
              {createWalletLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
