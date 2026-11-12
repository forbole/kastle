import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { numberToHex } from "viem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import AssetSearchPage, {
  type AssetSearchItem,
} from "@/ui/popup/asset-search/AssetSearchPage";
import type { NetworkType } from "@/ui/popup/kcc20/labels";
import { matchesQuery } from "@/components/dashboard/TokenListItem.tsx";
import { useTokenListStateByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  getChainTokenSymbol,
} from "@/lib/layer2";
import { textEllipsis } from "@/lib/utils.ts";
import {
  recentSearchesKey,
  useRecentSearches,
} from "@/lib/asset-search/recent";

export type Krc20Label = { name?: string; logo?: string };

// The dashboard row resolves a KRC-20 label and logo per token; this does the
// same off screen and reports up, so search matches what the row shows.
export function Krc20Probe({
  tick,
  onResolve,
}: {
  tick: string;
  onResolve: (tick: string, label: Krc20Label) => void;
}) {
  const { data } = useTokenInfo(tick);
  const { logo } = useKrc20Logo(tick);
  const info = data?.result?.[0];
  const name = info?.mod === "mint" ? info?.tick : info?.name;
  useEffect(() => {
    onResolve(tick, { name, logo });
  }, [tick, name, logo, onResolve]);
  return null;
}

// Every id carries what its detail route needs (see entrypoints/popup/router.tsx).
function routeFor(id: string) {
  const [kind, ...rest] = id.split(":");
  switch (kind) {
    case "kas":
      return "/kas-asset";
    case "krc20":
      return `/token-asset/${rest.join(":")}`;
    case "kcc20": {
      const [covenantId, ext] = rest;
      return `/kcc20/${covenantId}${ext ? `?ext=${ext}` : ""}`;
    }
    case "erc20":
      return `/erc20-asset/${rest[0]}/${rest[1]}`;
    case "evm-kas":
      return `/evm-asset/${rest[0]}`;
    default:
      return undefined;
  }
}

const evmNetwork = (chainName: string): NetworkType =>
  chainName.toLowerCase().includes("igra") ? "igraErc20" : "kasplexErc20";

export default function AssetSearch() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { account, wallet } = useWalletManager();
  const address = account?.address;
  const [query, setQuery] = useState("");

  const { data: krc20Tokens, isLoading: krc20Loading } =
    useTokenListStateByAddress(address, 5000);
  const { isKcc20Enabled } = useFeatureFlags();
  const { data: kcc20Tokens, isLoading: kcc20Loading } = useKcc20Tokens(
    isKcc20Enabled ? address : undefined,
  );
  // Same guard as the dashboard KCC-20 row: it does not open on Ledger.
  const canOpenKcc20 = isKcc20Enabled && wallet?.type !== "ledger";
  const { assets: erc20Assets, isLoading: erc20Loading } = useErc20Assets();

  const evmChains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const [krc20Labels, setKrc20Labels] = useState<Record<string, Krc20Label>>(
    {},
  );
  const onKrc20Resolve = useMemo(
    () => (tick: string, label: Krc20Label) =>
      setKrc20Labels((prev) =>
        prev[tick]?.name === label.name && prev[tick]?.logo === label.logo
          ? prev
          : { ...prev, [tick]: label },
      ),
    [],
  );

  const { recent, add, remove } = useRecentSearches(
    recentSearchesKey(settings?.networkId, address),
  );

  // Each entry: the row as the search screen draws it, plus the labels it matches on.
  const candidates = useMemo(() => {
    const list: { item: AssetSearchItem; labels: (string | undefined)[] }[] =
      [];
    list.push({
      item: {
        id: "kas",
        name: "KAS",
        kind: "asset",
        logo: kasIcon,
        network: "kaspa",
      },
      labels: ["KAS"],
    });
    for (const chain of evmChains) {
      const chainId = numberToHex(chain.id);
      const symbol = getChainTokenSymbol(chainId);
      list.push({
        item: {
          id: `evm-kas:${chainId}`,
          name: symbol,
          kind: "asset",
          logo: kasIcon,
          network: evmNetwork(chain.name),
        },
        labels: [symbol],
      });
    }
    for (const token of krc20Tokens ?? []) {
      const label = krc20Labels[token.id];
      list.push({
        item: {
          id: `krc20:${token.id}`,
          name: label?.name || token.id,
          kind: "asset",
          logo: label?.logo,
          network: "krc20",
        },
        labels: [label?.name, token.id],
      });
    }
    if (canOpenKcc20)
      for (const token of kcc20Tokens ?? []) {
        const symbol = token.meta?.symbol ?? token.tick;
        list.push({
          item: {
            id: `kcc20:${token.covenantId}${
              token.extensionCommitment ? `:${token.extensionCommitment}` : ""
            }`,
            name: symbol || textEllipsis(token.covenantId),
            kind: "asset",
            logo: token.meta?.logoURI,
            network: "kcc20",
          },
          labels: [symbol, token.meta?.name, token.covenantId],
        });
      }
    for (const asset of erc20Assets) {
      const chain = evmChains.find((c) => numberToHex(c.id) === asset.chainId);
      list.push({
        item: {
          id: `erc20:${asset.chainId}:${asset.address}`,
          name: asset.symbol,
          kind: "asset",
          logo: asset.image,
          network: chain ? evmNetwork(chain.name) : undefined,
        },
        labels: [asset.symbol],
      });
    }
    return list;
  }, [
    evmChains,
    krc20Tokens,
    krc20Labels,
    canOpenKcc20,
    kcc20Tokens,
    erc20Assets,
  ]);

  const results = useMemo(
    () =>
      query.trim() === ""
        ? []
        : candidates
            .filter(({ labels }) => matchesQuery(query, ...labels))
            .map(({ item }) => item),
    [candidates, query],
  );

  // Only a source that is enabled and still fetching shows skeletons; a source
  // with no account, switched off or failed has settled, so "No result" shows.
  const isLoading =
    (krc20Loading && krc20Tokens === undefined) ||
    (canOpenKcc20 && kcc20Loading && kcc20Tokens === undefined) ||
    (!!address && erc20Loading);

  const itemsById = useMemo(
    () => new Map(candidates.map(({ item }) => [item.id, item])),
    [candidates],
  );
  // A KCC-20 id opens only while the current list holds it (kill switch, Ledger).
  const isAvailable = (id: string) =>
    !id.startsWith("kcc20:") || itemsById.has(id);

  // Recents draw from the current list (live name/logo); the stored snapshot
  // only stands in for an id the list does not hold.
  const recentRows = useMemo(
    () =>
      recent.flatMap((stored) => {
        const live = itemsById.get(stored.id);
        if (live) return [live];
        return stored.id.startsWith("kcc20:") ? [] : [stored];
      }),
    [recent, itemsById],
  );

  const select = (item: AssetSearchItem) => {
    const route = routeFor(item.id);
    if (!route || !isAvailable(item.id)) return;
    void add(itemsById.get(item.id) ?? item);
    // Replace: back from the detail page lands on Home, not on search.
    navigate(route, { replace: true });
  };

  return (
    <>
      {krc20Tokens?.map((token) => (
        <Krc20Probe key={token.id} tick={token.id} onResolve={onKrc20Resolve} />
      ))}
      <AssetSearchPage
        query={query}
        onQueryChange={setQuery}
        onBack={() => navigate(-1)}
        recent={recentRows}
        results={results}
        isLoading={isLoading}
        onSelect={select}
        onRemoveRecent={(item) => void remove(item.id)}
      />
    </>
  );
}
