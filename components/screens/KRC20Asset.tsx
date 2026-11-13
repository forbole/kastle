import { useNavigate, useParams } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { formatUnits } from "viem";
import TokenDetailPage, {
  TokenDetailTab,
} from "@/ui/popup/kcc20/TokenDetailPage";
import TokenHistory from "@/components/krc20-asset/TokenHistory";
import { formatTokenPrice, setPopupPath } from "@/lib/utils.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import { krc20Decimals } from "@/lib/decimalAmount";
import { isMigratableTick } from "@/lib/kcc20/migration";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { useTokenBalance } from "@/hooks/kasplex/useTokenBalance";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";
import useCurrencyValue from "@/hooks/useCurrencyValue";
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
  let baseUnits: bigint | undefined;
  try {
    baseUnits = BigInt(rawBalance);
  } catch {
    baseUnits = undefined;
  }
  const holdsPositive = baseUnits !== undefined && baseUnits > 0n;
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
  // An unresolved network is not mainnet.
  const canMigrate =
    settings?.networkId === "mainnet" &&
    migration.enabled &&
    isMigratableTick(migration.config, ticker) &&
    holdsPositive;
  const { toFloat } = applyDecimal(tokenInfo?.dec);
  // Exact holding from the base-unit string at the token's own decimals:
  // formatUnits never rounds, so 1.9996 stays 1.9996 and dust is not "0".
  const exactBalance = (() => {
    if (baseUnits === undefined) return undefined;
    const [whole, fraction] = formatUnits(
      baseUnits,
      krc20Decimals(tokenInfo?.dec),
    ).split(".");
    // One formatter, one locale: grouping and the decimal separator agree.
    // A BigInt is grouped without a float; the fraction is kept verbatim.
    const locale = new Intl.NumberFormat();
    const grouped = locale.format(BigInt(whole));
    if (!fraction) return grouped;
    const separator =
      locale.formatToParts(0.5).find((part) => part.type === "decimal")
        ?.value ?? ".";
    return `${grouped}${separator}${fraction}`;
  })();
  const balanceLabel =
    !balanceResponse || exactBalance === undefined
      ? undefined
      : settings?.hideBalances
        ? "*****"
        : `${exactBalance}${tokenName ? ` ${tokenName}` : ""}`;
  // Same values and formatting as the legacy TokenInfo rows.
  const networkName =
    settings?.networkId === "mainnet" ? "Kaspa Mainnet" : "Kaspa Testnet";
  const tokenAddress = tokenInfo?.ca || undefined;
  const max = tokenInfo ? parseInt(tokenInfo.max, 10) : 0;
  const minted = tokenInfo ? parseInt(tokenInfo.minted, 10) : 0;
  const mintedPercentage = (minted / max) * 100;
  const countLabel = (value?: string) =>
    (value ? parseInt(value, 10) : 0).toLocaleString();
  const amountLabel = (value?: string) =>
    (value ? toFloat(parseInt(value, 10)) : 0).toLocaleString();
  const infoRows = tokenInfo && {
    modeLabel: tokenInfo.mod === "mint" ? "Mint" : "Issue",
    maxSupplyLabel: toFloat(max).toLocaleString(),
    totalMintedLabel: `${mintedPercentage < 0.1 ? "<0.1" : mintedPercentage.toFixed(1)}% (${toFloat(minted).toLocaleString()}/${toFloat(max).toLocaleString()})`,
    holderCount: countLabel(tokenInfo.holderTotal),
    mintCount: countLabel(tokenInfo.mintTotal),
    transferCount: countLabel(tokenInfo.transferTotal),
    preallocationAmount: amountLabel(tokenInfo.pre),
    defaultMintAmount: amountLabel(tokenInfo.lim),
    decimal: countLabel(tokenInfo.dec),
  };

  // USD price, converted like the KCC-20 page. The hook returns 0 until a KAS
  // price exists, so only a positive price is a real one: otherwise no
  // Price/Value row.
  const { price } = useKrc20Prices(ticker);
  const hasPrice = price !== undefined && price > 0;
  const { amount: fiatPrice, code: currencyCode } = useCurrencyValue(
    price ?? 0,
  );
  const priceLabel = hasPrice
    ? formatTokenPrice(fiatPrice, currencyCode)
    : undefined;
  const valueUsd =
    hasPrice && balanceResponse && tokenInfo
      ? toFloat(balance) * price
      : undefined;
  const { amount: fiatValue } = useCurrencyValue(valueUsd ?? 0);
  const valueLabel =
    valueUsd === undefined
      ? undefined
      : settings?.hideBalances
        ? "*****"
        : formatTokenPrice(fiatValue, currencyCode);
  const toDashboard = () => navigate("/dashboard");

  useEffect(() => {
    setPopupPath();
  }, []);

  return (
    <TokenDetailPage
      name={tokenName ?? ""}
      tokenName={tokenInfo?.name || undefined}
      balance={balanceLabel}
      logo={logo}
      network="krc20"
      networkName={networkName}
      tokenId={tokenAddress}
      onTokenIdPress={tokenAddress ? () => copy(tokenAddress) : undefined}
      priceLabel={priceLabel}
      valueLabel={valueLabel}
      {...infoRows}
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
