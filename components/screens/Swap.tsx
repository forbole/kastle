import React, { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Address,
  Hex,
  PublicClient,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  numberToHex,
  parseUnits,
} from "viem";
import { toAccount } from "viem/accounts";
import GeneralHeader from "@/components/GeneralHeader";
import toast from "@/components/Toast";
import {
  BottomSheet,
  ConfirmButton,
  QuoteRow,
  SheetToken,
  Skeleton,
  TermsGate,
  TokenPill,
  TokenSheet,
  AmountInput,
  formatAmount,
} from "@/components/swap-bridge/ui";
import BottomNav from "@/components/BottomNav";
import { NetworkType } from "@/contexts/SettingsContext";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { useErc20Price } from "@/hooks/evm/useErc20Prices";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import useFeeEstimateByGas, {
  SWAP_GAS_ESTIMATES,
} from "@/hooks/evm/useFeeEstimateByGas";
import {
  ZEALOUS_SWAP_IGRA_IMAGE_URL,
  ZEALOUS_SWAP_IMAGE_URL,
  useZealousSwapIgraTokensMetadata,
  useZealousSwapTokensMetadata,
} from "@/hooks/evm/provider/useZealousSwap";
import { igraMainnet, kasplexMainnet } from "@/lib/layer2";
import {
  SwapProvider,
  getSwapProvidersForChain,
  getWkasAddress,
  resolveSwapProviderForChain,
} from "@/lib/evm/swap/constants";
import { createPathFinder } from "@/lib/evm/swap/pathFinder";
import { createSwapExecutor } from "@/lib/evm/swap/swapExecutor";
import { swapMinReceived, swapPathAmountIn } from "@/lib/swap-bridge-quote";

type ChainKey = "kasplex" | "igra";
const CHAINS = { kasplex: kasplexMainnet, igra: igraMainnet };
const NATIVE = "native";
const SLIPPAGES = [0.5, 1, 2];

type SwapToken = SheetToken & { decimals: number };
type ProviderQuote = {
  provider: SwapProvider;
  path?: Address[];
  amountOut?: bigint;
};

const TOOLTIPS = {
  minReceived: {
    title: "Min Received",
    body: "The minimum number of output tokens you'll get after accounting for slippage.",
    footer:
      "The actual amount may vary slightly depending on network conditions.",
  },
  rate: {
    title: "Rate",
    body: "The current exchange ratio applied between the input and output tokens.",
  },
  provider: {
    title: "Provider",
    body: "The liquidity pool or DEX that routes and executes your swap.",
  },
  slippage: {
    title: "Slippage",
    body: "The difference between the expected and actual execution price due to insufficient liquidity or market volatility.",
  },
  priceImpact: {
    title: "Price Impact",
    body: "The percentage change in market price caused by the size of your trade.",
  },
};

export default function Swap() {
  const { networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;
  const { wallet } = useWalletManager();
  const evmAddress = useEvmAddress();
  const signer = useEvmHotWalletSigner();
  const { kaspaPrice } = useKaspaPrice();

  const [chainKey, setChainKey] = useState<ChainKey>("kasplex");
  const chain = CHAINS[chainKey];
  const chainHex = numberToHex(chain.id) as Hex;
  const client = useMemo(
    () =>
      createPublicClient({
        chain,
        transport: http(),
      }) as unknown as PublicClient,
    [chain],
  );

  // Token list: native + Zealous-listed + tokens the user already holds.
  // ponytail: KaspaCom-only listings are not merged, add their graph-pairs API if asked.
  const { data: zealousKasplex } = useZealousSwapTokensMetadata();
  const { data: zealousIgra } = useZealousSwapIgraTokensMetadata();
  const { assets } = useErc20Assets();
  const tokens = useMemo(() => {
    const list: SwapToken[] = [];
    for (const key of ["kasplex", "igra"] as ChainKey[]) {
      const c = CHAINS[key];
      list.push({
        key: `${key}:${NATIVE}`,
        chain: key,
        symbol: c.nativeCurrency.symbol,
        decimals: 18,
        chainImage: c.icon,
      });
      const zealous = key === "igra" ? zealousIgra : zealousKasplex;
      const imageBase =
        key === "igra" ? ZEALOUS_SWAP_IGRA_IMAGE_URL : ZEALOUS_SWAP_IMAGE_URL;
      for (const t of zealous?.tokens ?? []) {
        list.push({
          key: `${key}:${t.address.toLowerCase()}`,
          chain: key,
          symbol: t.symbol,
          address: t.address,
          decimals: t.decimals,
          image: `${imageBase}${t.logoURI}`,
          chainImage: c.icon,
        });
      }
      for (const a of assets.filter((a) => a.chainId === numberToHex(c.id))) {
        if (list.some((t) => t.key === `${key}:${a.address.toLowerCase()}`))
          continue;
        list.push({
          key: `${key}:${a.address.toLowerCase()}`,
          chain: key,
          symbol: a.symbol,
          address: a.address,
          decimals: a.decimals,
          image: a.image,
          chainImage: c.icon,
        });
      }
    }
    return list;
  }, [zealousKasplex, zealousIgra, assets]);

  const [tokenInKey, setTokenInKey] = useState<string | undefined>(
    `kasplex:${NATIVE}`,
  );
  const [tokenOutKey, setTokenOutKey] = useState<string>();
  const tokenIn = tokens.find((t) => t.key === tokenInKey);
  const tokenOut = tokens.find((t) => t.key === tokenOutKey);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(SLIPPAGES[0]);
  const [providerName, setProviderName] = useState<string>();
  const [sheet, setSheet] = useState<
    "in" | "out" | "provider" | "slippage" | "fee"
  >();
  const [submitting, setSubmitting] = useState(false);

  const isNativeIn = !tokenIn?.address;
  const isNativeOut = !tokenOut?.address;
  const wkas = getWkasAddress(chainHex);
  const routeIn = (tokenIn?.address as Address | undefined) ?? wkas;
  const routeOut = (tokenOut?.address as Address | undefined) ?? wkas;

  let rawIn = 0n;
  try {
    rawIn = tokenIn ? parseUnits(amount || "0", tokenIn.decimals) : 0n;
  } catch {
    rawIn = 0n;
  }

  // Balance of the input token plus native, for the network-fee check.
  const { data: balances } = useSWR(
    evmAddress && tokenIn
      ? ["swapBalances", chainHex, tokenIn.key, evmAddress]
      : null,
    async () => {
      const native = await client.getBalance({ address: evmAddress! });
      const input = isNativeIn
        ? native
        : await client.readContract({
            address: tokenIn!.address as Address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [evmAddress!],
          });
      return { native, input };
    },
    { refreshInterval: 10_000 },
  );

  const samePair = routeIn.toLowerCase() === routeOut.toLowerCase();
  const { data: quotes, isLoading: quotesLoading } = useSWR(
    isMainnet && tokenOut && rawIn > 0n && !samePair
      ? ["swapQuotes", chainHex, routeIn, routeOut, rawIn.toString()]
      : null,
    () =>
      Promise.all(
        getSwapProvidersForChain(chainHex).map(
          async (provider): Promise<ProviderQuote> => {
            try {
              const best = await createPathFinder(
                provider,
                client,
                wkas,
              ).findBestPath(
                routeIn,
                routeOut,
                swapPathAmountIn(rawIn, !!provider.feeCollectorAddress),
              );
              return { provider, path: best.path, amountOut: best.amountOut };
            } catch {
              return { provider };
            }
          },
        ),
      ),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  const supported = (quotes ?? []).filter((q) => q.amountOut);
  const best = supported.reduce<ProviderQuote | undefined>(
    (acc, q) => (!acc || q.amountOut! > acc.amountOut! ? q : acc),
    undefined,
  );
  const selected =
    supported.find((q) => q.provider.name === providerName) ?? best;

  const gas =
    (isNativeIn
      ? SWAP_GAS_ESTIMATES.KAS_TO_ERC20
      : isNativeOut
        ? SWAP_GAS_ESTIMATES.ERC20_TO_KAS
        : SWAP_GAS_ESTIMATES.ERC20_TO_ERC20) +
    (isNativeIn ? 0n : SWAP_GAS_ESTIMATES.APPROVAL);
  const { data: networkFeeWei } = useFeeEstimateByGas(gas, chainHex);

  const { price: erc20PriceIn } = useErc20Price(
    chainHex,
    tokenIn?.address as Address | undefined,
  );
  const { price: erc20PriceOut } = useErc20Price(
    chainHex,
    tokenOut?.address as Address | undefined,
  );
  const priceIn = isNativeIn ? kaspaPrice : erc20PriceIn;
  const priceOut = isNativeOut ? kaspaPrice : erc20PriceOut;

  const amountNum = Number(amount) || 0;
  const outNum =
    selected?.amountOut !== undefined && tokenOut
      ? Number(formatUnits(selected.amountOut, tokenOut.decimals))
      : undefined;
  const usdIn = amountNum * priceIn;
  const usdOut = (outNum ?? 0) * priceOut;
  const priceImpact =
    usdIn > 0 && usdOut > 0 ? (usdOut / usdIn - 1) * 100 : undefined;
  const nativeSymbol = chain.nativeCurrency.symbol;
  const viaFeeCollector = !!selected?.provider.feeCollectorAddress;
  const kastleFee = viaFeeCollector
    ? amountNum -
      Number(
        formatUnits(swapPathAmountIn(rawIn, true), tokenIn?.decimals ?? 18),
      )
    : 0;

  const error = (() => {
    if (wallet?.type === "ledger")
      return "Ledger doesn’t support swap currently.";
    if (!isMainnet) return "Swap is only available on mainnet.";
    if (rawIn === 0n || !tokenOut) return undefined;
    if (samePair) return "Unsupported token pair";
    if (balances && rawIn > balances.input)
      return "Oh, you don't have enough funds";
    if (balances && networkFeeWei !== undefined) {
      const needNative = (isNativeIn ? rawIn : 0n) + networkFeeWei;
      if (needNative > balances.native)
        return "Oh, you need more for the network fees";
    }
    if (quotes && supported.length === 0) return "Unsupported token pair";
    return undefined;
  })();

  const pickToken = (side: "in" | "out", t: SheetToken) => {
    const setThis = side === "in" ? setTokenInKey : setTokenOutKey;
    const otherKey = side === "in" ? tokenOutKey : tokenInKey;
    const setOther = side === "in" ? setTokenOutKey : setTokenInKey;
    if (t.chain !== chainKey) {
      // Both legs live on one chain: switching chain resets the other side.
      setChainKey(t.chain as ChainKey);
      setOther(side === "in" ? undefined : `${t.chain}:${NATIVE}`);
    } else if (otherKey === t.key) {
      setOther(side === "in" ? tokenInKey : tokenOutKey);
    }
    setThis(t.key);
    setProviderName(undefined);
  };

  const flip = () => {
    if (!tokenOutKey) return;
    setTokenInKey(tokenOutKey);
    setTokenOutKey(tokenInKey);
    setAmount("");
  };

  const onConfirm = async () => {
    if (!selected?.path || !signer || !evmAddress || !tokenIn || !tokenOut)
      return;
    // Sign against this chain's own record of the provider, never the quote's
    // object (see resolveSwapProviderForChain).
    const provider = resolveSwapProviderForChain(
      selected.provider.name,
      chainHex,
    );
    if (!provider) return;
    setSubmitting(true);
    try {
      const account = toAccount({
        address: evmAddress,
        signTransaction: (tx) => signer.signTransaction(tx),
        // ponytail: swaps only sign transactions; wire these if a flow needs them.
        signMessage: () => Promise.reject(new Error("Not supported")),
        signTypedData: () => Promise.reject(new Error("Not supported")),
      });
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(),
      });
      const executor = createSwapExecutor(
        provider,
        client,
        walletClient,
        wkas,
        await client.getGasPrice(),
      );
      const onApproved = () =>
        toast.info(`Swapping ${tokenIn.symbol} for ${tokenOut.symbol}`);
      if (isNativeIn) {
        onApproved();
        const receipt = await executor.swapKASForTokens(
          rawIn,
          selected.path,
          slippage,
        );
        if (receipt.status !== "success") throw new Error("Swap reverted");
      } else {
        toast.info(`Approving ${tokenIn.symbol} for swap`);
        const hash = isNativeOut
          ? await executor.swapTokensForKAS(
              tokenIn.address as Address,
              rawIn,
              selected.path,
              slippage,
              onApproved,
            )
          : await executor.swapTokensForTokens(
              tokenIn.address as Address,
              rawIn,
              selected.path,
              slippage,
              onApproved,
            );
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Swap reverted");
      }
      toast.success("Swapped successfully!");
      setAmount("");
    } catch (e) {
      console.error(e);
      toast.error("Swap failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const loading = quotesLoading && !quotes;
  const minReceived =
    selected?.amountOut !== undefined && tokenOut
      ? formatAmount(
          Number(
            formatUnits(
              swapMinReceived(selected.amountOut, slippage),
              tokenOut.decimals,
            ),
          ),
        )
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4">
        <GeneralHeader title="Swap" showClose={false} />

        <div className="flex items-center gap-2">
          <TokenPill
            symbol={tokenIn?.symbol ?? "Select"}
            tokenImage={tokenIn?.image}
            chainImage={tokenIn?.chainImage}
            onClick={() => setSheet("in")}
          />
          <i className="hn hn-arrow-right text-daintree-400" />
          <TokenPill
            symbol={tokenOut?.symbol ?? "Select"}
            tokenImage={tokenOut?.image}
            chainImage={tokenOut?.chainImage}
            onClick={() => setSheet("out")}
          />
        </div>

        <div className="relative">
          <AmountInput
            value={amount}
            onChange={setAmount}
            symbol={tokenIn?.symbol ?? ""}
            usd={usdIn > 0 ? `$${formatAmount(usdIn, 2)}` : undefined}
            balance={
              balances && tokenIn
                ? formatAmount(
                    Number(formatUnits(balances.input, tokenIn.decimals)),
                  )
                : undefined
            }
            onMax={
              balances && tokenIn && !isNativeIn
                ? () => setAmount(formatUnits(balances.input, tokenIn.decimals))
                : undefined
            }
          />
          <button
            type="button"
            aria-label="Flip"
            onClick={flip}
            className="absolute right-0 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/10"
          >
            <i className="hn hn-sort text-white" />
          </button>
        </div>

        {rawIn > 0n && tokenOut && !samePair && (
          <div className="rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-2">
            <QuoteRow label="Min Received" tooltip={TOOLTIPS.minReceived}>
              {loading ? (
                <Skeleton />
              ) : minReceived ? (
                `${minReceived} ${tokenOut.symbol}`
              ) : (
                "-"
              )}
            </QuoteRow>
            <QuoteRow label="Rate" tooltip={TOOLTIPS.rate}>
              {loading ? (
                <Skeleton />
              ) : outNum !== undefined && amountNum > 0 ? (
                `1 ${tokenIn?.symbol} ≈ ${formatAmount(outNum / amountNum)} ${tokenOut.symbol}`
              ) : (
                "-"
              )}
            </QuoteRow>
            <QuoteRow label="Est. Fee" onClick={() => setSheet("fee")}>
              {networkFeeWei === undefined ? (
                <Skeleton />
              ) : (
                `${formatAmount(Number(formatEther(networkFeeWei)))} ${nativeSymbol}`
              )}
            </QuoteRow>
            <QuoteRow
              label="Provider"
              tooltip={TOOLTIPS.provider}
              onClick={() => setSheet("provider")}
            >
              {selected ? (
                <>
                  <img
                    src={selected.provider.image}
                    alt=""
                    className="size-4 rounded-full"
                  />
                  {selected.provider.name}
                </>
              ) : loading ? (
                <Skeleton />
              ) : (
                "-"
              )}
            </QuoteRow>
            <QuoteRow
              label="Slippage"
              tooltip={TOOLTIPS.slippage}
              onClick={() => setSheet("slippage")}
            >
              {slippage}%
            </QuoteRow>
            <QuoteRow label="Price Impact" tooltip={TOOLTIPS.priceImpact}>
              {priceImpact === undefined
                ? "-"
                : `${formatAmount(priceImpact, 2)}%`}
            </QuoteRow>
            {viaFeeCollector && (
              <p className="mt-1 flex items-center gap-1 border-t border-daintree-700 pt-2 text-xs text-daintree-400">
                <i className="hn hn-info-circle" />
                Quote includes 0.75% Kastle fee
              </p>
            )}
          </div>
        )}

        <ConfirmButton
          error={error}
          disabled={!!error || !selected?.path || rawIn === 0n || !signer}
          loading={submitting}
          onClick={onConfirm}
        />
      </div>
      <BottomNav />
      <TermsGate kind="Swap" />

      {(["in", "out"] as const).map((side) => (
        <TokenSheet
          key={side}
          open={sheet === side}
          onClose={() => setSheet(undefined)}
          chains={[
            { key: "kasplex", label: "Kasplex" },
            { key: "igra", label: "Igra" },
          ]}
          chain={chainKey}
          onChain={(k) => {
            setChainKey(k as ChainKey);
            setTokenInKey(`${k}:${NATIVE}`);
            setTokenOutKey(undefined);
          }}
          tokens={tokens}
          onSelect={(t) => pickToken(side, t)}
          recentKey="local:swap_recent_tokens"
        />
      ))}

      <BottomSheet
        title="Select Provider"
        open={sheet === "provider"}
        onClose={() => setSheet(undefined)}
      >
        {(quotes ?? []).map((q) => {
          const rate =
            q.amountOut !== undefined && tokenOut && amountNum > 0
              ? Number(formatUnits(q.amountOut, tokenOut.decimals)) / amountNum
              : undefined;
          const isSelected = q.provider.name === selected?.provider.name;
          return (
            <button
              key={q.provider.name}
              type="button"
              disabled={!q.amountOut}
              onClick={() => {
                setProviderName(q.provider.name);
                setSheet(undefined);
              }}
              className="flex items-center gap-3 rounded-lg border border-daintree-700 p-3 text-left disabled:opacity-40"
            >
              <img
                src={q.provider.image}
                alt=""
                className="size-8 rounded-full"
              />
              <div className="flex flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  {q.provider.name}
                  {q === best && (
                    <span className="rounded-full bg-teal-500/10 px-2 text-[10px] text-teal-500">
                      Recommended
                    </span>
                  )}
                </span>
                <span className="text-xs text-daintree-400">
                  {rate !== undefined
                    ? `1 ${tokenIn?.symbol} ≈ ${formatAmount(rate)} ${tokenOut?.symbol}`
                    : "Unsupported Pair"}
                </span>
              </div>
              {isSelected && (
                <i className="hn hn-check-circle text-icy-blue-400" />
              )}
            </button>
          );
        })}
      </BottomSheet>

      <BottomSheet
        title="Slippage"
        open={sheet === "slippage"}
        onClose={() => setSheet(undefined)}
      >
        <p className="text-sm text-daintree-400">{TOOLTIPS.slippage.body}</p>
        <div className="flex gap-2">
          {SLIPPAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSlippage(s);
                setSheet(undefined);
              }}
              className={
                s === slippage
                  ? "flex-1 rounded-full border border-icy-blue-400 py-2 text-sm text-icy-blue-400"
                  : "flex-1 rounded-full border border-daintree-700 py-2 text-sm text-daintree-400"
              }
            >
              {s}%
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        title="Est. Fee"
        open={sheet === "fee"}
        onClose={() => setSheet(undefined)}
      >
        <div className="flex justify-between text-sm">
          <span className="text-daintree-400">Network</span>
          <span className="text-white">
            {networkFeeWei !== undefined
              ? `${formatAmount(Number(formatEther(networkFeeWei)))} ${nativeSymbol}`
              : "-"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-daintree-400">Kastle</span>
          <span className="text-white">
            {viaFeeCollector
              ? `${formatAmount(kastleFee)} ${tokenIn?.symbol}`
              : "-"}
          </span>
        </div>
      </BottomSheet>
    </div>
  );
}
