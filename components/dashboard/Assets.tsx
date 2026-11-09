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
  ROW,
} from "@/components/dashboard/TokenListItem.tsx";
import TokenRow from "@/ui/popup/dashboard/TokenRow";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { applyDecimal } from "@/lib/krc20.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import Erc20Assets from "@/components/dashboard/Erc20Assets";
import EvmKasAsset from "./EvmKasAsset";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
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
  const {
    hidden,
    loaded: hiddenLoaded,
    save,
  } = useHiddenTokens(hiddenTokensKey(settings?.networkId, address));
  // Manage mode edits a draft; Done writes it once.
  const [draft, setDraft] = useState<Set<string>>();
  const managing = draft !== undefined;
  const enterManage = () => setDraft(new Set(hidden));
  const leaveManage = () => {
    if (draft) void save(draft);
    setDraft(undefined);
  };
  const manageFor = (id: string) =>
    draft && {
      shown: !draft.has(id),
      onToggle: (shown: boolean) =>
        setDraft((prev) => {
          const next = new Set(prev);
          if (shown) next.delete(id);
          else next.add(id);
          return next;
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
      {/*KAS: no toggle, it cannot be hidden*/}
      <div
        data-testid="kas-row"
        className={`${ROW} cursor-pointer`}
        onClick={() => navigate("/kas-asset")}
      >
        <TokenRow
          logo={kasIcon}
          ticker="KAS"
          price={formatTokenPrice(kaspaPriceCurrency, kaspaPriceCurrencyCode)}
          balance={showBalance ? formatToken(balance ?? 0) : "*****"}
          fiat={`≈ ${
            showBalance
              ? formatCurrency(totalBalanceCurrency, currencyCode)
              : `${symbolForCurrencyCode(currencyCode)}*****`
          }`}
        />
      </div>

      {/*EVM KAS*/}
      {supportEvmL2s.length > 0 &&
        supportEvmL2s.map((chain) => (
          <EvmKasAsset key={chain.id} chainId={numberToHex(chain.id)} />
        ))}

      {/*Manage: hide or show KRC-20 / KCC-20 rows; no section header, one flat list*/}
      {tokenCount > 0 && (
        <div className="flex justify-end text-sm">
          <button
            type="button"
            className="rounded-lg px-2 py-1 font-semibold text-icy-blue-400 hover:bg-daintree-800 hover:text-icy-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-icy-blue-400"
            onClick={managing ? leaveManage : enterManage}
          >
            {managing ? "Done" : "Manage"}
          </button>
        </div>
      )}

      {allHidden && (
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
        />
      ))}

      {/*KCC20 tokens*/}
      {shownKcc20?.map((token) => (
        <Kcc20TokenListItem
          key={kcc20Id(token)}
          token={token}
          manage={manageFor(kcc20Id(token))}
        />
      ))}

      {/* ERC20 tokens */}
      <Erc20Assets />
    </div>
  );
}
