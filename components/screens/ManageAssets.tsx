import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { numberToHex, type Address, type Hex } from "viem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import ManageAssetsPage, {
  MANAGE_ASSETS_LABELS,
  type ManageAssetsToken,
} from "@/ui/popup/manage-assets/ManageAssetsPage";
import { Krc20Probe, type Krc20Label } from "@/components/screens/AssetSearch";
import { useSettings } from "@/hooks/useSettings";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { useKrc20FilledToken } from "@/lib/kcc20/useKcc20Price";
import type { Kcc20Token } from "@/lib/kcc20";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import { useErc20Balances } from "@/hooks/evm/useErc20Balance";
import { useEvmKasBalances } from "@/hooks/evm/useEvmKasBalance";
import { useErc20Image } from "@/hooks/evm/useErc20Info";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  getChainImage,
  getChainTokenSymbol,
} from "@/lib/layer2";
import { applyDecimal } from "@/lib/krc20.ts";
import { formatTokenAmount, textEllipsis } from "@/lib/utils.ts";
import { formatKcc20Balance } from "@/ui/popup/kcc20/labels";
import {
  erc20HideId,
  hiddenTokensKey,
  kcc20HideId,
  krc20HideId,
  useHiddenTokens,
} from "@/lib/hidden-tokens";

type Label = { name?: string; logo?: string };

/** Native KAS ids: never in the hidden set, since their rows are locked. */
const KAS_L1_ID = "kas";
const evmKasId = (chainId: string) => `evm-kas:${chainId}`;

const L1 = { chainBadge: kasIcon, chainLabel: "Kaspa L1" };
const l2Label = (chainName: string) =>
  chainName.toLowerCase().includes("igra") ? "Igra L2" : "Kasplex L2";

// The dashboard KCC-20 row fills empty metadata from its KRC-20 namesake;
// this does the same off screen and reports up.
function Kcc20Probe({
  token,
  onResolve,
}: {
  token: Kcc20Token;
  onResolve: (id: string, label: Label) => void;
}) {
  const filled = useKrc20FilledToken(token);
  const id = kcc20HideId(token.covenantId, token.extensionCommitment);
  const name = filled.meta?.symbol ?? filled.tick;
  const logo = filled.meta?.logoURI;
  useEffect(() => {
    onResolve(id, { name, logo });
  }, [id, name, logo, onResolve]);
  return null;
}

// The dashboard ERC-20 row falls back to the swap provider's logo.
function Erc20LogoProbe({
  id,
  chainId,
  address,
  onResolve,
}: {
  id: string;
  chainId: string;
  address: string;
  onResolve: (id: string, label: Label) => void;
}) {
  const { logoUrl } = useErc20Image(chainId as Hex, address as Address);
  useEffect(() => {
    onResolve(id, { logo: logoUrl });
  }, [id, logoUrl, onResolve]);
  return null;
}

export default function ManageAssets() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { account } = useWalletManager();
  const address = account?.address;
  const showBalance = !settings?.hideBalances;

  const kasBalance = useKaspaBalance(address);
  const { data: evmKasBalances } = useEvmKasBalances();
  const krc20Tokens = useTokenListByAddress(address, 5000);
  const { isKcc20Enabled } = useFeatureFlags();
  const { data: kcc20Tokens } = useKcc20Tokens(
    isKcc20Enabled ? address : undefined,
  );
  const { assets: erc20Assets } = useErc20Assets();
  const { data: erc20Balances } = useErc20Balances();

  const evmChains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const hiddenKey = hiddenTokensKey(settings?.networkId, address);
  const { hidden, loaded, save } = useHiddenTokens(hiddenKey);

  const [labels, setLabels] = useState<Record<string, Label>>({});
  const onResolve = useCallback(
    (id: string, label: Label) =>
      setLabels((prev) =>
        prev[id]?.name === label.name && prev[id]?.logo === label.logo
          ? prev
          : { ...prev, [id]: label },
      ),
    [],
  );
  const onKrc20Resolve = useCallback(
    (tick: string, label: Krc20Label) => onResolve(krc20HideId(tick), label),
    [onResolve],
  );

  const tokens = useMemo(() => {
    const list: ManageAssetsToken[] = [];
    // Pre-formatted with the ticker; masked like the dashboard row.
    const shown = (amount: string, ticker?: string) =>
      `${showBalance ? amount : "*****"}${ticker ? ` ${ticker}` : ""}`;
    const nativeLock = {
      visible: true,
      locked: true,
      lockedReason: MANAGE_ASSETS_LABELS.nativeLocked,
    };

    list.push({
      id: KAS_L1_ID,
      name: "KAS",
      logo: kasIcon,
      balance: shown(formatTokenAmount(kasBalance ?? 0), "KAS"),
      ...nativeLock,
    });

    for (const chain of evmChains) {
      const chainId = numberToHex(chain.id);
      const symbol = getChainTokenSymbol(chainId);
      const balance = parseFloat(evmKasBalances?.[chainId]?.balance ?? "0");
      list.push({
        id: evmKasId(chainId),
        name: symbol,
        logo: kasIcon,
        chainBadge: getChainImage(chainId),
        chainLabel: l2Label(chain.name),
        balance: shown(formatTokenAmount(balance), symbol),
        ...nativeLock,
      });
    }

    const sortedKrc20 = [...(krc20Tokens ?? [])].sort((a, b) => {
      const { toFloat: aToFloat } = applyDecimal(a.dec);
      const { toFloat: bToFloat } = applyDecimal(b.dec);
      return (
        bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
      );
    });
    for (const token of sortedKrc20) {
      const id = krc20HideId(token.id);
      const name = labels[id]?.name || token.id;
      const { toFloat } = applyDecimal(token.dec);
      const amount = toFloat(token.balance ? parseInt(token.balance, 10) : 0);
      list.push({
        id,
        name,
        logo: labels[id]?.logo,
        ...L1,
        balance: shown(formatTokenAmount(amount), name),
        visible: !hidden.has(id),
      });
    }

    for (const token of kcc20Tokens ?? []) {
      const id = kcc20HideId(token.covenantId, token.extensionCommitment);
      const name =
        labels[id]?.name ||
        token.meta?.symbol ||
        token.tick ||
        textEllipsis(token.covenantId);
      // Without decimals the amount already reads "… base units": no ticker.
      const ticker = token.meta?.decimals === undefined ? undefined : name;
      list.push({
        id,
        name,
        logo: labels[id]?.logo ?? token.meta?.logoURI,
        ...L1,
        balance: shown(formatKcc20Balance(token), ticker),
        visible: !hidden.has(id),
      });
    }

    for (const asset of erc20Assets) {
      const id = erc20HideId(asset.chainId, asset.address);
      const chain = evmChains.find((c) => numberToHex(c.id) === asset.chainId);
      const entry = erc20Balances?.find(
        (b) =>
          b.chainId === asset.chainId &&
          b.tokenAddress?.toLowerCase() === asset.address.toLowerCase(),
      );
      const amount = entry && !("error" in entry) ? entry.balance : 0;
      list.push({
        id,
        name: asset.symbol,
        logo: asset.image ?? labels[id]?.logo,
        chainBadge: getChainImage(asset.chainId as Hex),
        chainLabel: chain ? l2Label(chain.name) : undefined,
        balance: shown(formatTokenAmount(amount), asset.symbol),
        visible: !hidden.has(id),
      });
    }

    return list;
  }, [
    showBalance,
    kasBalance,
    evmChains,
    evmKasBalances,
    krc20Tokens,
    kcc20Tokens,
    erc20Assets,
    erc20Balances,
    labels,
    hidden,
  ]);

  const lockedIds = useMemo(
    () => new Set(tokens.filter((t) => t.locked).map((t) => t.id)),
    [tokens],
  );

  const onToggle = (id: string, visible: boolean) => {
    // Native KAS is locked on every network (Kaspa L1 and each EVM L2), so at
    // least one row always stays visible: the design's "last visible token
    // can't be switched off" rule can never trigger and needs no guard here.
    // Before storage is read, a write would drop the stored set.
    if (lockedIds.has(id) || !loaded) return;
    const next = new Set(hidden);
    if (visible) next.delete(id);
    else next.add(id);
    void save(next);
  };

  return (
    <>
      {krc20Tokens?.map((token) => (
        <Krc20Probe key={token.id} tick={token.id} onResolve={onKrc20Resolve} />
      ))}
      {kcc20Tokens?.map((token) => (
        <Kcc20Probe
          key={kcc20HideId(token.covenantId, token.extensionCommitment)}
          token={token}
          onResolve={onResolve}
        />
      ))}
      {erc20Assets
        .filter((asset) => !asset.image)
        .map((asset) => {
          const id = erc20HideId(asset.chainId, asset.address);
          return (
            <Erc20LogoProbe
              key={id}
              id={id}
              chainId={asset.chainId}
              address={asset.address}
              onResolve={onResolve}
            />
          );
        })}
      <ManageAssetsPage
        tokens={tokens}
        onToggle={onToggle}
        onBack={() => navigate(-1)}
      />
    </>
  );
}
