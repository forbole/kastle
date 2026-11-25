import { FeeRow } from "@/components/swap-bridge/swap-fee-summary";
import { ProviderRow } from "@/components/swap-bridge/ui";
import {
  isL1Enabled,
  type L1FeatureFlags,
  type L1Provider,
  type L1ProviderId,
} from "@/hooks/swap/l1Providers";
import type { FeeLine, Money } from "@/hooks/swap/l1Types";
import { formatAmount } from "@/lib/format-amount";

/**
 * The provider sheet's L1 rows. A provider whose flag is off has no row; an
 * enabled one that does not route the pair is greyed as "Unsupported Pair".
 */
export function L1ProviderRows({
  providers,
  flags,
  supporting,
  currentId,
  rate,
  onPick,
}: {
  providers: readonly L1Provider[];
  flags: L1FeatureFlags;
  supporting: readonly L1Provider[];
  currentId: L1ProviderId;
  /** The current provider's "1 X ≈ n Y" line, when there is a quote. */
  rate?: string;
  onPick: (id: L1ProviderId) => void;
}) {
  return providers
    .filter((p) => isL1Enabled(p, flags))
    .map((p) => {
      const supports = supporting.includes(p);
      const current = p.id === currentId;
      return (
        <ProviderRow
          key={p.id}
          image={p.image}
          name={p.name}
          subtitle={!supports ? "Unsupported Pair" : current ? rate : undefined}
          selected={current}
          disabled={!supports}
          onClick={() => onPick(p.id)}
        />
      );
    });
}

/** An L1 provider's Est. Fee rows: network first, then each fee but Kastle's (the summary's). */
export function L1FeeRows({ lines }: { lines: readonly FeeLine[] }) {
  const network = lines.find((l) => l.name === "Network");
  return (
    <>
      <FeeRow
        label="Network fees"
        value={network?.display ?? "-"}
        note={network?.hint}
      />
      {lines
        .filter((l) => l.name !== "Network" && l.name !== "Kastle")
        .map((l) => (
          <FeeRow
            key={l.name}
            label={`${l.name} fees`}
            value={l.display}
            note={l.hint}
          />
        ))}
    </>
  );
}

/**
 * What the built tx moves in and out of the wallet: the total debit and each
 * signed credit, a row apiece. Never fees, so none enters the fee sum.
 */
export function L1WalletRows({
  totalDebit,
  creditLines = [],
}: {
  totalDebit?: Money;
  creditLines?: readonly FeeLine[];
}) {
  return (
    <>
      {totalDebit && (
        <FeeRow
          label="Total debit"
          value={`-${formatAmount(totalDebit.amount)} ${totalDebit.symbol}`}
          note="Everything this transaction takes from your wallet"
        />
      )}
      {creditLines.map((l) => (
        <FeeRow key={l.name} label={l.name} value={l.display} note={l.hint} />
      ))}
    </>
  );
}
