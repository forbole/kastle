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
  PairArrow,
  ProviderRow,
  QuoteRow,
  SheetToken,
  Skeleton,
  TermsGate,
  TokenPill,
  TokenSheet,
  AmountInput,
  formatAmount,
} from "@/components/swap-bridge/ui";
import BottomNav, { ActivityHeaderButton } from "@/components/BottomNav";
import { NetworkType } from "@/contexts/SettingsContext";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useAnalytics from "@/hooks/useAnalytics";
import { useErc20Price } from "@/hooks/evm/useErc20Prices";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import { useErc20Balances } from "@/hooks/evm/useErc20Balance";
import { useEvmKasBalances } from "@/hooks/evm/useEvmKasBalance";
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
import {
  createSwapExecutor,
  readSwapFeeBps,
} from "@/lib/evm/swap/swapExecutor";
import { swapMinReceived, swapPathAmountIn } from "@/lib/swap-bridge-quote";

type ChainKey = "kasplex" | "igra";
const CHAINS = { kasplex: kasplexMainnet, igra: igraMainnet };
const NATIVE = "native";
const SLIPPAGES = [0.5, 1, 2];

type SwapToken = SheetToken & { decimals: number };
type ProviderQuote = {
  provider: SwapProvider;
  feeBps?: bigint;
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

const NETWORK_FEE_ERROR = "Oh, you need more for the network fees";

export default function Swap() {
  const { networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;
  const { wallet } = useWalletManager();
  const evmAddress = useEvmAddress();
  const signer = useEvmHotWalletSigner();
  const { kaspaPrice } = useKaspaPrice();
  const { emitSwapCompleted } = useAnalytics();

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
  // KaspaCom-only listings are not merged, add their graph-pairs API if asked.
  const { data: zealousKasplex } = useZealousSwapTokensMetadata();
  const { data: zealousIgra } = useZealousSwapIgraTokensMetadata();
  const { assets } = useErc20Assets();
  // Sheet balances come from the app-wide cached hooks, as on mobile: tokens
  // the user does not hold show no balance.
  const { data: nativeBalances } = useEvmKasBalances();
  const { data: erc20Balances } = useErc20Balances();
  const tokens = useMemo(() => {
    const erc20Balance = (chainId: Hex, address: string) => {
      const b = erc20Balances?.find(
        (b) =>
          !("error" in b) &&
          b.chainId === chainId &&
          b.tokenAddress.toLowerCase() === address.toLowerCase(),
      );
      return b && !("error" in b)
        ? formatAmount(b.balance, Math.min(b.decimals, 8))
        : undefined;
    };
    const list: SwapToken[] = [];
    for (const key of ["kasplex", "igra"] as ChainKey[]) {
      const c = CHAINS[key];
      const hex = numberToHex(c.id) as Hex;
      const native = nativeBalances?.[hex]?.balance;
      list.push({
        key: `${key}:${NATIVE}`,
        chain: key,
        symbol: c.nativeCurrency.symbol,
        decimals: 18,
        chainImage: c.icon,
        balance:
          native === undefined ? undefined : formatAmount(Number(native), 8),
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
          balance: erc20Balance(hex, t.address),
        });
      }
      for (const a of assets.filter((a) => a.chainId === hex)) {
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
          balance: erc20Balance(hex, a.address),
        });
      }
    }
    return list;
  }, [zealousKasplex, zealousIgra, assets, nativeBalances, erc20Balances]);

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
              const feeBps = provider.feeCollectorAddress
                ? await readSwapFeeBps(client, provider.feeCollectorAddress)
                : 0n;
              const best = await createPathFinder(
                provider,
                client,
                wkas,
              ).findBestPath(
                routeIn,
                routeOut,
                swapPathAmountIn(rawIn, feeBps),
              );
              return {
                provider,
                feeBps,
                path: best.path,
                amountOut: best.amountOut,
              };
            } catch {
              return { provider };
            }
          },
        ),
      ),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  // keepPreviousData serves the previous pair's quotes until the refetch
  // lands; a path for another pair must never be shown or signed.
  const matchesRoute = (path?: Address[]) =>
    !!path?.length &&
    path[0].toLowerCase() === routeIn.toLowerCase() &&
    path[path.length - 1].toLowerCase() === routeOut.toLowerCase();
  const supported = (quotes ?? []).filter(
    (q) => q.amountOut && matchesRoute(q.path),
  );
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
  const feeBps = selected?.feeBps ?? 0n;
  const kastleFee = viaFeeCollector
    ? amountNum -
      Number(
        formatUnits(swapPathAmountIn(rawIn, feeBps), tokenIn?.decimals ?? 18),
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
      if (needNative > balances.native) return NETWORK_FEE_ERROR;
    }
    if (quotes && !quotesLoading && supported.length === 0)
      return "Unsupported token pair";
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
    if (
      !selected?.path ||
      !matchesRoute(selected.path) ||
      !signer ||
      !evmAddress ||
      !tokenIn ||
      !tokenOut
    )
      return;
    // Sign against this chain's own record of the provider, never the quote's
    // object (see resolveSwapProviderForChain).
    const provider = resolveSwapProviderForChain(
      selected.provider.name,
      chainHex,
    );
    if (!provider) return;
    const trackSwap = (status: "success" | "failed") =>
      emitSwapCompleted({
        status,
        chainId: chain.id,
        from: tokenIn.address ?? null,
        to: tokenOut.address ?? null,
        router: provider.routerAddress,
        sender: evmAddress,
        value_native: amountNum,
        native_asset: tokenIn.symbol,
        ...(usdIn > 0 && { value_usd: usdIn }),
        ...(kastleFee > 0 && {
          fee_amount: kastleFee,
          fee_asset: tokenIn.symbol,
        }),
      });
    setSubmitting(true);
    try {
      const account = toAccount({
        address: evmAddress,
        signTransaction: (tx) => signer.signTransaction(tx),
        // Swaps only sign transactions; wire these if a flow needs them.
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
      trackSwap("success");
      setAmount("");
    } catch (e) {
      console.error(e);
      toast.error("Swap failed. Please try again.");
      trackSwap("failed");
    } finally {
      setSubmitting(false);
    }
  };

  const loading = quotesLoading && supported.length === 0;
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
  // Hidden when the output token has no price, rather than showing $0.00.
  const minReceivedUsd =
    selected?.amountOut !== undefined && tokenOut && priceOut > 0
      ? Number(
          formatUnits(
            swapMinReceived(selected.amountOut, slippage),
            tokenOut.decimals,
          ),
        ) * priceOut
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 px-4 pt-4">
        <GeneralHeader
          title="Swap"
          showClose={false}
          titleClassName="text-gray-200"
        />
        <ActivityHeaderButton type="swap" />
      </div>
      <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto px-4">
        <div className="mb-4 flex items-center justify-between">
          <TokenPill
            symbol={tokenIn?.symbol ?? "Select"}
            tokenImage={tokenIn?.image}
            chainImage={tokenIn?.chainImage}
            onClick={() => setSheet("in")}
          />
          <PairArrow />
          <TokenPill
            symbol={tokenOut?.symbol ?? "Select"}
            tokenImage={tokenOut?.image}
            chainImage={tokenOut?.chainImage}
            onClick={() => setSheet("out")}
          />
        </div>

        <AmountInput
          value={amount}
          onChange={setAmount}
          symbol={tokenIn?.symbol ?? ""}
          tokenImage={tokenIn?.image}
          chainImage={tokenIn?.chainImage}
          usd={`$${formatAmount(usdIn, 2)}`}
          onFlip={flip}
          flipDisabled={!tokenOutKey}
        />

        {/* The network-fee error keeps the card: its Est. Fee row explains it. */}
        {rawIn > 0n &&
          tokenOut &&
          !samePair &&
          (!error || error === NETWORK_FEE_ERROR) && (
            <div className="shrink-0 overflow-hidden rounded-xl border border-daintree-700 bg-daintree-800">
              <QuoteRow label="Min Received" tooltip={TOOLTIPS.minReceived}>
                {loading ? (
                  <Skeleton />
                ) : minReceived ? (
                  <span className="flex flex-col items-end">
                    ~ {minReceived} {tokenOut.symbol}
                    {minReceivedUsd !== undefined && (
                      <span className="text-xs text-daintree-400">
                        (≈ ${formatAmount(minReceivedUsd, 2)} USD)
                      </span>
                    )}
                  </span>
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
              <QuoteRow
                label="Est. Fee"
                onClick={() => setSheet("fee")}
                noChevron
                infoOpensRow
              >
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
                      className="size-[26px] rounded-full"
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
                <p className="flex items-center gap-2 border-t border-daintree-700 px-4 py-3 text-xs font-medium text-daintree-400">
                  <i className="hn hn-info-circle text-base" />
                  Quote includes {Number(feeBps) / 100}% Kastle Fee
                </p>
              )}
            </div>
          )}
      </div>
      <ConfirmButton
        error={error}
        balance={
          balances && tokenIn
            ? `${formatAmount(
                Number(formatUnits(balances.input, tokenIn.decimals)),
              )} ${tokenIn.symbol}`
            : undefined
        }
        onMax={
          balances && tokenIn && !isNativeIn
            ? () => setAmount(formatUnits(balances.input, tokenIn.decimals))
            : undefined
        }
        disabled={!!error || !selected?.path || rawIn === 0n || !signer}
        loading={submitting}
        onClick={onConfirm}
      />
      <BottomNav />
      <TermsGate kind="Swap" />

      {(["in", "out"] as const).map((side) => (
        <TokenSheet
          key={side}
          open={sheet === side}
          onClose={() => setSheet(undefined)}
          chains={[
            { key: "kasplex", label: "Kasplex", image: CHAINS.kasplex.icon },
            { key: "igra", label: "Igra", image: CHAINS.igra.icon },
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
        tall
      >
        {(quotes ?? []).map((q) => {
          const rate =
            q.amountOut !== undefined && tokenOut && amountNum > 0
              ? Number(formatUnits(q.amountOut, tokenOut.decimals)) / amountNum
              : undefined;
          return (
            <ProviderRow
              key={q.provider.name}
              image={q.provider.image}
              name={q.provider.name}
              subtitle={
                rate !== undefined
                  ? `1 ${tokenIn?.symbol} ≈ ${formatAmount(rate)} ${tokenOut?.symbol}`
                  : "Unsupported Pair"
              }
              selected={q.provider.name === selected?.provider.name}
              recommended={q === best}
              disabled={!q.amountOut}
              onClick={() => {
                setProviderName(q.provider.name);
                setSheet(undefined);
              }}
            />
          );
        })}
      </BottomSheet>

      <BottomSheet
        title="Slippage"
        open={sheet === "slippage"}
        onClose={() => setSheet(undefined)}
        tall
      >
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
                  ? "w-[72px] rounded-lg border border-icy-blue-400 bg-white/10 px-3 py-2.5 text-[15px] font-semibold text-white"
                  : "w-[72px] rounded-lg border border-transparent bg-white/10 px-3 py-2.5 text-[15px] font-semibold text-white"
              }
            >
              {s}%
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        title="Est. Fee"
        subtitle="The estimated total cost for this transaction"
        open={sheet === "fee"}
        onClose={() => setSheet(undefined)}
      >
        {[
          // "Swap fees" row (in the design) is hidden until the quote carries DEX fee data.
          {
            label: "Network fees",
            value:
              networkFeeWei !== undefined
                ? `${formatAmount(Number(formatEther(networkFeeWei)))} ${nativeSymbol}`
                : "-",
          },
          {
            label: "Kastle fees",
            value: viaFeeCollector
              ? `${formatAmount(kastleFee)} ${tokenIn?.symbol}`
              : "-",
            note: viaFeeCollector
              ? `Quote includes ${Number(feeBps) / 100}% Kastle Fee`
              : undefined,
          },
        ].map(({ label, value, note }) => (
          <div
            key={label}
            className="flex flex-col gap-1 rounded-lg px-3 py-2 text-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-semibold text-white">{label}</span>
              <span className="flex-none whitespace-nowrap text-white">
                {value}
              </span>
            </div>
            {note && <span className="text-xs text-daintree-400">{note}</span>}
          </div>
        ))}
      </BottomSheet>
    </div>
  );
}
