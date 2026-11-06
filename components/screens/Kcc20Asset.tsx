import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCopyToClipboard } from "usehooks-ts";
import TokenDetailPage, {
  TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import Header from "@/components/GeneralHeader";
import { Kcc20History } from "@/components/kcc20-asset/Kcc20History";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { useKcc20Price } from "@/lib/kcc20/useKcc20Price";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { formatTokenPrice, setPopupPath, textEllipsis } from "@/lib/utils";
import { KCC20_LABELS } from "@/ui/popup/kcc20/labels";

export default function Kcc20Asset() {
  const navigate = useNavigate();
  const { covenantId = "" } = useParams();
  const [searchParams] = useSearchParams();
  // A token id can have one row per extension commitment; the route names the row.
  const rowExt = searchParams.get("ext");
  const { account } = useWalletManager();
  const { data: tokens, isLoading, error } = useKcc20Tokens(account?.address);
  const [activeTab, setActiveTab] = useState<TokenDetailTab>("history");
  const [, copy] = useCopyToClipboard();

  const token = tokens?.find(
    (t) =>
      t.covenantId === covenantId &&
      (!rowExt || t.extensionCommitment === rowExt),
  );
  const meta = token?.meta;
  // Before the row loads there is nothing to price; the label stays hidden.
  const { priceUsd } = useKcc20Price(
    token ?? { covenantId, family: "kron-legacy", meta: undefined },
  );
  const { amount: fiatPrice, code: currencyCode } = useCurrencyValue(
    priceUsd ?? 0,
  );
  const priceLabel =
    token && priceUsd !== undefined
      ? formatTokenPrice(fiatPrice, currencyCode)
      : undefined;
  // The route guard rules out Ledger; only verified, owned pieces are sendable.
  const canSend =
    meta?.decimals !== undefined && !!token && token.spendable > 0n;

  useEffect(() => {
    setPopupPath();
  }, []);

  const toDashboard = () => navigate("/dashboard");

  // An unresolved lookup has no metadata yet: do not show it as unverified.
  if (!token && isLoading) return <Kcc20AssetPending />;
  if (!token && error) {
    return (
      <div className="flex h-full flex-col px-4 pb-4 pt-6">
        <Header
          variant="asset"
          title={textEllipsis(covenantId)}
          onBack={toDashboard}
          onClose={toDashboard}
        />
        <span className="text-center text-base font-medium text-daintree-400">
          {KCC20_LABELS.loadFailed}
        </span>
      </div>
    );
  }

  return (
    <TokenDetailPage
      name={(meta?.symbol ?? token?.tick) || textEllipsis(covenantId)}
      logo={meta?.logoURI}
      network="kcc20"
      networkName="Kaspa"
      tokenId={textEllipsis(covenantId)}
      onTokenIdPress={() => copy(covenantId)}
      isVerified={!!meta && !meta.unverified}
      decimal={meta?.decimals === undefined ? undefined : String(meta.decimals)}
      priceLabel={priceLabel}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      history={<Kcc20History address={account?.address} token={token} />}
      onSend={
        canSend
          ? () =>
              navigate(
                `/kcc20/send/${covenantId}${rowExt ? `?ext=${rowExt}` : ""}`,
              )
          : undefined
      }
      onBack={toDashboard}
      onClose={toDashboard}
    />
  );
}

// What the KCC-20 route shows while its guard waits for the wallet and the
// flags: the same top bar, so the page is never blank. Nothing else, as the
// guard has not ruled out Ledger yet.
export function Kcc20AssetPending() {
  const navigate = useNavigate();
  const { covenantId = "" } = useParams();
  const toDashboard = () => navigate("/dashboard");

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={textEllipsis(covenantId)}
        onBack={toDashboard}
        onClose={toDashboard}
      />
    </div>
  );
}
