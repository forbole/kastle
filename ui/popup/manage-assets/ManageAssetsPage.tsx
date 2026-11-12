import type { ReactNode } from "react";
import PageHeader from "@/ui/general/PageHeader";
import Switch from "@/ui/general/Switch";
import AssetImage from "@/ui/popup/kcc20/AssetImage";

export interface ManageAssetsToken {
  id: string;
  /** Ticker shown on the row, e.g. "KAS". */
  name: string;
  logo?: string;
  /** Corner badge image of the chain the token lives on; omit for native KAS. */
  chainBadge?: string;
  /** Chain name shown when the badge is hovered, e.g. "Kasplex L2". */
  chainLabel?: string;
  /** Pre-formatted, with the ticker: "1,000 KAS". */
  balance: string;
  /** Whether the token shows in the wallet view and the total balance. */
  visible: boolean;
  /** The switch is disabled: KAS on every network cannot be hidden. */
  locked?: boolean;
  /** Tooltip on a locked row's switch: why it cannot be toggled. */
  lockedReason?: string;
}

export interface ManageAssetsPageProps {
  tokens: ManageAssetsToken[];
  onToggle: (id: string, visible: boolean) => void;
  onBack?: () => void;
}

export const MANAGE_ASSETS_LABELS = {
  title: "Manage Assets",
  subtitle: "Show or hide tokens in your wallet view and total balance.",
  /** lockedReason for KAS on every network (L1, Kasplex L2, Igra L2). */
  nativeLocked: "KAS always stays visible",
};

/** Shown on hover or keyboard focus of the nearest `group/tip` ancestor. */
function Tooltip({ text, className }: { text: string; className: string }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-20 hidden w-max max-w-[200px] rounded bg-daintree-700 px-2.5 py-2 text-center text-sm font-medium text-white group-focus-within/tip:block group-hover/tip:block ${className}`}
    >
      {text}
    </span>
  );
}

/** A disabled button gets no hover or focus, so the wrapper carries the tooltip and the tab stop. */
function SwitchWithTip({
  tip,
  children,
}: {
  tip?: string;
  children: ReactNode;
}) {
  if (!tip) return <>{children}</>;
  return (
    <span
      tabIndex={0}
      aria-label={tip}
      className="group/tip relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
    >
      {children}
      <Tooltip
        text={tip}
        className="right-full top-1/2 mr-2 -translate-y-1/2"
      />
    </span>
  );
}

function TokenToggleRow({
  token,
  onToggle,
}: {
  token: ManageAssetsToken;
  onToggle: ManageAssetsPageProps["onToggle"];
}) {
  const { id, name, logo, chainBadge, chainLabel, balance, visible } = token;
  // Every locked row explains itself: fall back to the native-KAS wording.
  const lockedTip = token.locked
    ? token.lockedReason || MANAGE_ASSETS_LABELS.nativeLocked
    : undefined;

  return (
    <li className="flex items-center justify-between rounded-lg px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <AssetImage
            variant="chain"
            tokenImage={logo}
            chainImage={chainBadge}
          />
          {chainBadge && chainLabel && (
            // Hover and focus target is the corner badge only, as in Figma.
            <span
              tabIndex={0}
              aria-label={chainLabel}
              className="group/tip absolute bottom-0 right-0 size-4 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
            >
              <Tooltip
                text={chainLabel}
                className="left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap"
              />
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-semibold text-white">
            {name}
          </span>
          <span className="truncate text-xs text-daintree-400">{balance}</span>
        </div>
      </div>
      <SwitchWithTip tip={lockedTip}>
        <Switch
          checked={visible}
          disabled={token.locked}
          onChange={(next) => onToggle(id, next)}
          label={`Show ${name}${chainLabel ? ` on ${chainLabel}` : ""}`}
        />
      </SwitchWithTip>
    </li>
  );
}

/** Popup "Manage Assets": one switch per token to show or hide it in the wallet view. */
export default function ManageAssetsPage({
  tokens,
  onToggle,
  onBack,
}: ManageAssetsPageProps) {
  return (
    <div className="flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title={MANAGE_ASSETS_LABELS.title}
        subtitle={MANAGE_ASSETS_LABELS.subtitle}
        onBack={onBack}
        paddingBottom="pb-10"
      />
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4">
        {tokens.map((token) => (
          <TokenToggleRow key={token.id} token={token} onToggle={onToggle} />
        ))}
      </ul>
    </div>
  );
}
