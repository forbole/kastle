import { BadgeCheck, ExternalLink } from "lucide-react";
import PageHeader from "@/ui/general/PageHeader";
import SegmentedControl from "@/ui/general/SegmentedControl";
import AssetImage from "./AssetImage";
import NetworkTypeChip from "./NetworkTypeChip";
import { KCC20_LABELS, NetworkType } from "./labels";

export type TokenDetailTab = "history" | "assetInfo";

const TABS = [
  { label: KCC20_LABELS.historyTab, value: "history" as const },
  { label: KCC20_LABELS.assetInfoTab, value: "assetInfo" as const },
];

export interface TokenDetailPageProps {
  name: string;
  /** Display-ready, e.g. "$0.00041". */
  priceLabel?: string;
  logo?: string;
  fallback?: string;
  network: NetworkType;
  /** Value of the Network row, e.g. "Kaspa". */
  networkName: string;
  /** Covenant id (KCC-20) or contract address (KRC-20 / ERC-20), display-ready. */
  tokenId: string;
  onTokenIdPress?: () => void;
  /** Only ever shown for KCC-20: the registry entry verified against its genesis tx. */
  isVerified?: boolean;
  // Full variant: each row renders only when its value is passed.
  totalMintedPercent?: string;
  totalMintedFraction?: string;
  mintCount?: string;
  holderCount?: string;
  transferCount?: string;
  preallocationAmount?: string;
  defaultMintAmount?: string;
  decimal?: string;
  minter?: string;
  activeTab: TokenDetailTab;
  onTabChange: (tab: TokenDetailTab) => void;
  /** History tab: Figma's designed state is a single link out to the explorer. */
  onOpenExplorer?: () => void;
  onBack?: () => void;
  onClose?: () => void;
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-card-border py-3.5 text-sm leading-[21px] last:border-b-0">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2 text-right">
        {children}
      </div>
    </div>
  );
}

export default function TokenDetailPage({
  name,
  priceLabel,
  logo,
  fallback,
  network,
  networkName,
  tokenId,
  onTokenIdPress,
  isVerified = false,
  totalMintedPercent,
  totalMintedFraction,
  mintCount,
  holderCount,
  transferCount,
  preallocationAmount,
  defaultMintAmount,
  decimal,
  minter,
  activeTab,
  onTabChange,
  onOpenExplorer,
  onBack,
  onClose,
}: TokenDetailPageProps) {
  const isKcc20 = network === "kcc20";
  const showVerified = isVerified && isKcc20;
  const optionalRows: [string, string | undefined][] = [
    [KCC20_LABELS.mintCount, mintCount],
    [KCC20_LABELS.holderCount, holderCount],
    [KCC20_LABELS.transferCount, transferCount],
    [KCC20_LABELS.preallocationAmount, preallocationAmount],
    [KCC20_LABELS.defaultMintAmount, defaultMintAmount],
    [KCC20_LABELS.decimal, decimal],
    [KCC20_LABELS.minter, minter],
  ];
  const tokenImage = (
    <AssetImage
      variant="chain"
      tokenImage={logo}
      fallback={fallback}
      network={network}
    />
  );

  return (
    <div className="flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title={name}
        onBack={onBack}
        showClose={!!onClose}
        onClose={onClose}
      />

      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-6">
        <div className="pb-2">
          <SegmentedControl
            options={TABS}
            value={activeTab}
            onChange={onTabChange}
          />
        </div>

        {/* Header card: the Home asset row plus the chip */}
        <div className="flex items-center gap-3 rounded-2xl border border-card-border bg-white/5 px-3 py-3">
          {tokenImage}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-base font-semibold leading-4">
                {name}
              </span>
              {showVerified && (
                <BadgeCheck
                  aria-label={KCC20_LABELS.verified}
                  className="size-4 shrink-0 text-verified"
                  strokeWidth={2}
                />
              )}
            </div>
            {priceLabel && (
              <span className="truncate text-sm leading-[21px] text-daintree-300">
                {priceLabel}
              </span>
            )}
          </div>
          <NetworkTypeChip network={network} />
        </div>

        {activeTab === "assetInfo" ? (
          <section className="flex flex-col">
            <h2 className="py-3 text-base font-semibold text-daintree-300">
              {KCC20_LABELS.tokenInfo}
            </h2>
            <div className="rounded-2xl border border-card-border bg-daintree-800 px-4">
              <InfoRow label={KCC20_LABELS.network}>
                <span className="truncate">{networkName}</span>
              </InfoRow>
              <InfoRow
                label={
                  isKcc20
                    ? KCC20_LABELS.covenantId
                    : KCC20_LABELS.contractAddress
                }
              >
                {onTokenIdPress ? (
                  <button
                    type="button"
                    onClick={onTokenIdPress}
                    className="truncate hover:text-icy-blue-400"
                  >
                    {tokenId}
                  </button>
                ) : (
                  <span className="truncate">{tokenId}</span>
                )}
              </InfoRow>
              {totalMintedPercent && (
                <InfoRow label={KCC20_LABELS.totalMinted}>
                  <div className="flex flex-col items-end">
                    <span className="text-teal-400">{totalMintedPercent}</span>
                    {totalMintedFraction && (
                      <span className="text-xs text-daintree-300">
                        {totalMintedFraction}
                      </span>
                    )}
                  </div>
                </InfoRow>
              )}
              {optionalRows.map(
                ([label, value]) =>
                  value && (
                    <InfoRow key={label} label={label}>
                      <span className="truncate">{value}</span>
                    </InfoRow>
                  ),
              )}
              {isKcc20 && (
                <InfoRow label={KCC20_LABELS.security}>
                  {isVerified && (
                    <BadgeCheck
                      aria-hidden="true"
                      className="size-4 shrink-0 text-verified"
                      strokeWidth={2}
                    />
                  )}
                  <span>
                    {isVerified
                      ? KCC20_LABELS.verified
                      : KCC20_LABELS.unverified}
                  </span>
                </InfoRow>
              )}
            </div>
          </section>
        ) : (
          <button
            type="button"
            disabled={!onOpenExplorer}
            onClick={onOpenExplorer}
            className="flex items-center gap-2 rounded-2xl border border-card-border bg-white/5 px-4 py-3 text-left enabled:hover:border-white"
          >
            {tokenImage}
            <span className="flex-1 text-base font-medium">
              {KCC20_LABELS.viewInExplorer}
            </span>
            <ExternalLink aria-hidden="true" className="size-5 shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
}
