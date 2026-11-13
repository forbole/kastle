import { useNavigate, useParams } from "react-router-dom";
import React, { useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import TokenDetailPage, {
  TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import TokenHistory from "@/components/krc20-asset/TokenHistory";
import { setPopupPath } from "@/lib/utils.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import { isMigratableTick } from "@/lib/kcc20/migration";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { useTokenBalance } from "@/hooks/kasplex/useTokenBalance";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import { useKcc20Migration } from "@/hooks/useKcc20Migration";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { NetworkType } from "@/contexts/SettingsContext";
import { useSettings } from "@/hooks/useSettings";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function TokenAsset() {
  const navigate = useNavigate();
  const { ticker } = useParams();
  const [activeTab, setActiveTab] = useState<TokenDetailTab>("history");
  const [, copy] = useCopyToClipboard();
  const [settings] = useSettings();
  const { networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;

  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;
  const { logo } = useKrc20Logo(ticker);
  const { account, wallet, isWalletSettingsLoading } = useWalletManager();
  const { data: balanceResponse } = useTokenBalance(
    account && ticker
      ? { address: account.address, tokenId: ticker }
      : undefined,
  );
  const rawBalance = balanceResponse?.result?.[0]?.balance ?? "0";
  const balance = parseFloat(rawBalance);
  // Base units, as the migration's own holdings check reads them.
  let holdsPositive = false;
  try {
    holdsPositive = BigInt(rawBalance) > 0n;
  } catch {
    holdsPositive = false;
  }
  // As in the send asset picker: Ledger cannot send KRC-20. A wallet that has
  // not loaded yet is not known to be non-Ledger.
  const canSend =
    !!tokenName &&
    !isWalletSettingsLoading &&
    !!wallet &&
    wallet.type !== "ledger" &&
    balance > 0;
  // Same source as the Bridge migrate row: flags on, mainnet, an account.
  const migration = useKcc20Migration({
    address: account?.address,
    isMainnet,
  });
  const canMigrate =
    migration.enabled &&
    isMigratableTick(migration.config, ticker) &&
    holdsPositive;
  const { toFloat } = applyDecimal(tokenInfo?.dec);
  const balanceLabel = !balanceResponse
    ? undefined
    : settings?.hideBalances
      ? "*****"
      : `${toFloat(balance).toLocaleString()}${tokenName ? ` ${tokenName}` : ""}`;
  const toDashboard = () => navigate("/dashboard");

  useEffect(() => {
    setPopupPath();
  }, []);

  // KRC-20 has no price feed here: no Price or Value row.
  return (
    <TokenDetailPage
      name={tokenName ?? ""}
      tokenName={tokenInfo?.name || undefined}
      balance={balanceLabel}
      logo={logo}
      network="krc20"
      networkName="Kaspa"
      tokenId={ticker ?? ""}
      onTokenIdPress={ticker ? () => copy(ticker) : undefined}
      decimal={tokenInfo?.dec}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      history={<TokenHistory />}
      canMigrate={canMigrate}
      onMigrate={() => navigate("/migration-guide")}
      onSend={canSend ? () => navigate(`/krc20/send/${ticker}`) : undefined}
      onBack={toDashboard}
      onClose={toDashboard}
    />
  );
}
