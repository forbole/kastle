import { useNavigate } from "react-router-dom";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import {
  formatCurrency,
  formatToken,
  formatTokenPrice,
  symbolForCurrencyCode,
} from "@/lib/utils.ts";
import TokenListItem, {
  Kcc20TokenListItem,
  matchesQuery,
  ROW,
} from "@/components/dashboard/TokenListItem.tsx";
import TokenRow from "@/ui/popup/dashboard/TokenRow";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { applyDecimal } from "@/lib/krc20.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import Erc20Asset from "@/components/dashboard/Erc20Asset";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import EvmKasAsset from "./EvmKasAsset";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  getChainTokenSymbol,
} from "@/lib/layer2";
import { numberToHex } from "viem";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import { useState } from "react";
import {
  hiddenTokensKey,
  kcc20HideId,
  krc20HideId,
  saveHiddenTokens,
  useHiddenTokens,
} from "@/lib/hidden-tokens";

export default function Assets() {
  const navigate = useNavigate();
  const kaspaPrice = useKaspaPrice();

  const [settings] = useSettings();
  const { account } = useWalletManager();

  const address = account?.address;
  const balance = useKaspaBalance(address);
  const fiatBalance = (balance ?? 0) * kaspaPrice.kaspaPrice;
  const showBalance = !settings?.hideBalances;
  const fiatKaspaPrice = kaspaPrice.kaspaPrice;

  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);
  const { amount: kaspaPriceCurrency, code: kaspaPriceCurrencyCode } =
    useCurrencyValue(fiatKaspaPrice);

  const tokenListItems = useTokenListByAddress(address, 5000);
  const tokens = tokenListItems?.sort((a, b) => {
    const { toFloat: aToFloat } = applyDecimal(a.dec);
    const { toFloat: bToFloat } = applyDecimal(b.dec);

    return (
      bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
    );
  });

  // Kill switch off: no indexer polling, so the address never leaves the wallet.
  const { isKcc20Enabled } = useFeatureFlags();
  const { data: kcc20Tokens } = useKcc20Tokens(
    isKcc20Enabled ? address : undefined,
  );

  // Hiding is a display filter on this list only; balances, totals, send,
  // swap and detail pages never read the hidden set.
  const hiddenKey = hiddenTokensKey(settings?.networkId, address);
  const { hidden, loaded: hiddenLoaded } = useHiddenTokens(hiddenKey);
  // Manage mode edits a draft; Done writes it once, to the key it was
  // started for. Switching account or network (the side menu keeps this list
  // mounted) discards it, so one account's draft never lands on another's.
  const [started, setStarted] = useState<{ key: string; ids: Set<string> }>();
  if (started && started.key !== hiddenKey) setStarted(undefined);
  const draft = started && started.key === hiddenKey ? started.ids : undefined;
  const managing = draft !== undefined;
  const enterManage = () =>
    hiddenKey && setStarted({ key: hiddenKey, ids: new Set(hidden) });
  const leaveManage = () => {
    if (started && started.key === hiddenKey)
      void saveHiddenTokens(started.key, started.ids);
    setStarted(undefined);
  };
  const manageFor = (id: string) =>
    draft && {
      shown: !draft.has(id),
      onToggle: (shown: boolean) =>
        setStarted((prev) => {
          if (!prev) return prev;
          const ids = new Set(prev.ids);
          if (shown) ids.delete(id);
          else ids.add(id);
          return { key: prev.key, ids };
        }),
    };
  const isShown = (id: string) => managing || !hidden.has(id);
  const kcc20Id = (t: { covenantId: string; extensionCommitment?: string }) =>
    kcc20HideId(t.covenantId, t.extensionCommitment);
  const shownKrc20 = tokens?.filter((t) => isShown(krc20HideId(t.id)));
  const shownKcc20 = kcc20Tokens?.filter((t) => isShown(kcc20Id(t)));
  const tokenCount = (tokens?.length ?? 0) + (kcc20Tokens?.length ?? 0);
  const allHidden =
    !managing && tokenCount > 0 && !shownKrc20?.length && !shownKcc20?.length;

  // Search filters in place on the label each row renders; ids only add matches.
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const { assets: erc20Assets } = useErc20Assets();

  const isAssetListLoading = balance === undefined || !hiddenLoaded;

  const supportEvmL2s =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  return isAssetListLoading ? (
    <div className="flex animate-pulse items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
      <span className="block size-12 rounded-full bg-daintree-700"></span>
      <div className="h-[44px] flex-grow self-center rounded-xl bg-daintree-700" />
    </div>
  ) : (
    <div className="mb-4 flex flex-col items-stretch gap-2">
      {/*Header row above every asset row: search, then the Manage control at its right edge*/}
      <div data-testid="assets-header" className="flex items-stretch gap-2">
        <div className="relative flex flex-1 items-center">
          <i
            className="hn hn-search pointer-events-none absolute start-0 ps-4 text-base text-daintree-400"
            aria-hidden
          />
          <input
            type="search"
            aria-label="Search assets"
            placeholder="Search assets"
            autoComplete="off"
            className="block h-11 w-full rounded-lg border-daintree-700 bg-daintree-800 pe-10 ps-10 text-sm text-white placeholder-daintree-400 focus:border-daintree-700 focus:ring-daintree-700 [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute end-0 flex h-full items-center pe-4 ps-2 text-daintree-400 hover:text-white focus:outline-none focus-visible:text-white"
              onClick={() => setQuery("")}
            >
              <i className="hn hn-times-circle text-base" aria-hidden />
            </button>
          )}
        </div>
        {tokenCount > 0 && (
          <button
            type="button"
            aria-label={managing ? undefined : "Manage"}
            className="ml-auto flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-daintree-700 bg-daintree-800 text-sm font-semibold text-icy-blue-400 hover:border-white hover:text-icy-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
            onClick={managing ? leaveManage : enterManage}
          >
            {managing ? (
              <span className="px-2">Done</span>
            ) : (
              <i className="hn hn-grid text-base" aria-hidden />
            )}
          </button>
        )}
      </div>

      {/*Rows; the empty state shows only when it is the sole child (no row matched)*/}
      <div className="flex flex-col items-stretch gap-2">
        {/*KAS: no toggle, it cannot be hidden*/}
        {matchesQuery(query, "KAS") && (
          <div
            data-testid="kas-row"
            className={`${ROW} cursor-pointer`}
            onClick={() => navigate("/kas-asset")}
          >
            <TokenRow
              logo={kasIcon}
              ticker="KAS"
              price={formatTokenPrice(
                kaspaPriceCurrency,
                kaspaPriceCurrencyCode,
              )}
              balance={showBalance ? formatToken(balance ?? 0) : "*****"}
              fiat={`≈ ${
                showBalance
                  ? formatCurrency(totalBalanceCurrency, currencyCode)
                  : `${symbolForCurrencyCode(currencyCode)}*****`
              }`}
            />
          </div>
        )}

        {/*EVM KAS*/}
        {supportEvmL2s
          .map((chain) => numberToHex(chain.id))
          .filter((chainId) =>
            matchesQuery(query, getChainTokenSymbol(chainId)),
          )
          .map((chainId) => (
            <EvmKasAsset key={chainId} chainId={chainId} />
          ))}

        {allHidden && !searching && (
          <div
            data-testid="tokens-all-hidden"
            className="flex flex-col items-center gap-2 rounded-xl border border-daintree-700 bg-daintree-800 p-4 text-center text-sm text-daintree-400"
          >
            <span>All your tokens are hidden.</span>
            <button
              type="button"
              className="font-semibold text-icy-blue-400 hover:text-icy-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
              onClick={enterManage}
            >
              Show tokens
            </button>
          </div>
        )}

        {/*KRC20 tokens*/}
        {shownKrc20?.map((token) => (
          <TokenListItem
            key={token.id}
            token={token}
            manage={manageFor(krc20HideId(token.id))}
            query={query}
          />
        ))}

        {/*KCC20 tokens*/}
        {shownKcc20
          ?.filter((t) =>
            matchesQuery(
              query,
              t.meta?.symbol ?? t.tick,
              t.meta?.name,
              t.covenantId,
            ),
          )
          .map((token) => (
            <Kcc20TokenListItem
              key={kcc20Id(token)}
              token={token}
              manage={manageFor(kcc20Id(token))}
            />
          ))}

        {/* ERC20 tokens */}
        {erc20Assets
          .filter((asset) => matchesQuery(query, asset.symbol))
          .map((asset) => (
            <Erc20Asset
              key={`${asset.chainId}-${asset.address}`}
              asset={asset}
            />
          ))}

        {searching && (
          <div
            data-testid="assets-no-match"
            className="hidden flex-col items-center gap-2 rounded-xl border border-daintree-700 bg-daintree-800 p-4 text-center text-sm text-daintree-400 only:flex"
          >
            <span>No assets match “{query.trim()}”.</span>
            <button
              type="button"
              className="font-semibold text-icy-blue-400 hover:text-icy-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
              onClick={() => setQuery("")}
            >
              Show all assets
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
