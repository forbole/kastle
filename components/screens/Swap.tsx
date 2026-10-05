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
  formatUsd,
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
  KASPA_COM_PARTNER_KEY,
  getSwapProvidersForChain,
  getWkasAddress,
  resolveSwapProviderForChain,
} from "@/lib/evm/swap/constants";
import { createPathFinder } from "@/lib/evm/swap/pathFinder";
import {
  createSwapExecutor,
  readSwapFeeBps,
} from "@/lib/evm/swap/swapExecutor";
import {
  computeSwapKastleFee,
  swapMinReceived,
  swapPathAmountIn,
} from "@/lib/swap-bridge-quote";
import {
  FeeRow,
  SwapFeeFootnote,
  SwapFeeSummary,
} from "@/components/swap-bridge/swap-fee-summary";

type ChainKey = "kasplex" | "igra";
const CHAINS = { kasplex: kasplexMainnet, igra: igraMainnet };
const NATIVE = "native";
const SLIPPAGES = [0.5, 1, 2];
const MIN_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 50;

/** KaspaCom proxy's partner-fee lookup (same ABI as mobile's useSwapFee). */
const SWAP_PROXY_ABI = [
  {
    inputs: [{ name: "partnerKey", type: "bytes32" }],
    name: "partners",
    outputs: [
      { name: "feeRecipient", type: "address" },
      { name: "feeBps", type: "uint16" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** `rawBalance` is the numeric balance (formatted `balance` is for display). */
type SwapToken = SheetToken & { decimals: number; rawBalance?: number };
type ProviderQuote = {
  provider: SwapProvider;
  feeBps?: bigint;
  path?: Address[];
  amountOut?: bigint;
  /** What the user receives: amountOut less the proxy's output-side partner fee. */
  netAmountOut?: bigint;
  partnerFeeBps?: number;
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
    footer:
      "A fee charged by the liquidity provider on each swap, deducted from the output amount you receive.",
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

  const [chainKey, setChainKey] = useState<ChainKey>("igra");
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
    const erc20Entry = (chainId: Hex, address: string) => {
      const b = erc20Balances?.find(
        (b) =>
          !("error" in b) &&
          b.chainId === chainId &&
          b.tokenAddress.toLowerCase() === address.toLowerCase(),
      );
      return b && !("error" in b) ? b : undefined;
    };
    const erc20Balance = (chainId: Hex, address: string) => {
      const b = erc20Entry(chainId, address);
      return b ? formatAmount(b.balance, Math.min(b.decimals, 8)) : undefined;
    };
    const erc20Raw = (chainId: Hex, address: string) => {
      const b = erc20Entry(chainId, address);
      return b ? Number(b.balance) : undefined;
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
        rawBalance: native === undefined ? undefined : Number(native),
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
          rawBalance: erc20Raw(hex, t.address),
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
          rawBalance: erc20Raw(hex, a.address),
        });
      }
      // Default swap target (WiKAS on Igra) must resolve even if unlisted.
      const wrapped = getWkasAddress(hex)?.toLowerCase();
      if (
        key === "igra" &&
        wrapped &&
        !list.some((t) => t.key === `igra:${wrapped}`)
      )
        list.push({
          key: `igra:${wrapped}`,
          chain: key,
          symbol: "WiKAS",
          address: getWkasAddress(hex),
          decimals: 18,
          chainImage: c.icon,
          balance: erc20Balance(hex, wrapped),
          rawBalance: erc20Raw(hex, wrapped),
        });
    }
    return list;
  }, [zealousKasplex, zealousIgra, assets, nativeBalances, erc20Balances]);

  const [tokenInKey, setTokenInKey] = useState<string | undefined>(
    `igra:${NATIVE}`,
  );
  const [tokenOutKey, setTokenOutKey] = useState<string | undefined>(
    `igra:${getWkasAddress(numberToHex(CHAINS.igra.id) as Hex)?.toLowerCase()}`,
  );
  const tokenIn = tokens.find((t) => t.key === tokenInKey);
  const tokenOut = tokens.find((t) => t.key === tokenOutKey);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(SLIPPAGES[0]);
  const [customSlippageInput, setCustomSlippageInput] = useState("");
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
              // KaspaCom has no fee collector: its cut is a partner fee held by
              // the proxy contract and taken from the output token.
              const viaProxy =
                !provider.feeCollectorAddress && !!provider.proxyAddress;
              const partnerFeeBps = viaProxy
                ? await client
                    .readContract({
                      address: provider.proxyAddress as Address,
                      abi: SWAP_PROXY_ABI,
                      functionName: "partners",
                      args: [KASPA_COM_PARTNER_KEY as Hex],
                    })
                    .then(([, bps]) => Number(bps))
                    .catch(() => undefined)
                : undefined;
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
                partnerFeeBps,
                netAmountOut: !viaProxy
                  ? best.amountOut
                  : partnerFeeBps === undefined
                    ? undefined
                    : (best.amountOut * BigInt(10_000 - partnerFeeBps)) /
                      10_000n,
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
    (acc, q) =>
      q.netAmountOut !== undefined &&
      (!acc || q.netAmountOut > acc.netAmountOut!)
        ? q
        : acc,
    undefined,
  );
  const selected =
    supported.find((q) => q.provider.name === providerName) ??
    best ??
    supported[0];

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
    selected?.netAmountOut !== undefined && tokenOut
      ? Number(formatUnits(selected.netAmountOut, tokenOut.decimals))
      : undefined;
  const usdIn = amountNum * priceIn;
  const usdOut = (outNum ?? 0) * priceOut;
  const priceImpact =
    usdIn > 0 && usdOut > 0 ? (usdOut / usdIn - 1) * 100 : undefined;
  const nativeSymbol = chain.nativeCurrency.symbol;
  const viaFeeCollector = !!selected?.provider.feeCollectorAddress;
  const feeBps = selected?.feeBps ?? 0n;

  const partnerFeeBps = selected?.partnerFeeBps;
  const feeUnavailable =
    !viaFeeCollector &&
    !!selected?.provider.proxyAddress &&
    selected.netAmountOut === undefined;

  const { kastleFeeBps, kastleFeeSymbol, kastleFee } = computeSwapKastleFee({
    viaFeeCollector,
    feeBps,
    partnerFeeBps,
    amountNum,
    rawIn,
    amountOut: tokenOut ? selected?.amountOut : undefined,
    tokenInDecimals: tokenIn?.decimals ?? 18,
    tokenInSymbol: tokenIn?.symbol,
    tokenOutDecimals: tokenOut?.decimals ?? 18,
    tokenOutSymbol: tokenOut?.symbol,
  });

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
    if (feeUnavailable) return "Unable to load the KaspaCom partner fee.";
    return undefined;
  })();

  const pickToken = (side: "in" | "out", t: SheetToken) => {
    const setThis = side === "in" ? setTokenInKey : setTokenOutKey;
    const setOther = side === "in" ? setTokenOutKey : setTokenInKey;
    if (t.chain !== chainKey) {
      // Both legs live on one chain: switching chain resets the other side.
      setChainKey(t.chain as ChainKey);
      setOther(side === "in" ? undefined : `${t.chain}:${NATIVE}`);
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
          fee_asset: kastleFeeSymbol ?? tokenIn.symbol,
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
    selected?.netAmountOut !== undefined && tokenOut
      ? formatAmount(
          Number(
            formatUnits(
              swapMinReceived(selected.netAmountOut, slippage),
              tokenOut.decimals,
            ),
          ),
        )
      : undefined;
  // Hidden when the output token has no price, rather than showing $0.00.
  const minReceivedUsd =
    selected?.netAmountOut !== undefined && tokenOut && priceOut > 0
      ? Number(
          formatUnits(
            swapMinReceived(selected.netAmountOut, slippage),
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
          usd={`$${formatUsd(usdIn)}`}
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
                        (≈ ${formatUsd(minReceivedUsd)} USD)
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
              <SwapFeeFootnote
                kastleFee={kastleFee}
                kastleFeeBps={kastleFeeBps}
              />
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
          balances && tokenIn
            ? isNativeIn
              ? networkFeeWei !== undefined
                ? () =>
                    setAmount(
                      formatUnits(
                        balances.native > networkFeeWei
                          ? balances.native - networkFeeWei
                          : 0n,
                        tokenIn.decimals,
                      ),
                    )
                : undefined
              : () => setAmount(formatUnits(balances.input, tokenIn.decimals))
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
          tokens={
            side === "in"
              ? tokens
                  .filter((t) => (t.rawBalance ?? 0) > 0)
                  .map((t) => ({ ...t, disabled: t.key === tokenOutKey }))
              : tokens.map((t) => ({ ...t, disabled: t.key === tokenInKey }))
          }
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
            q.netAmountOut !== undefined && tokenOut && amountNum > 0
              ? Number(formatUnits(q.netAmountOut, tokenOut.decimals)) /
                amountNum
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
        subtitle="Your transaction will revert if the price moves unfavorably by more than this percentage."
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
                setCustomSlippageInput("");
                setSheet(undefined);
              }}
              className={
                s === slippage && !customSlippageInput
                  ? "w-[72px] rounded-lg border border-icy-blue-400 bg-white/10 px-3 py-2.5 text-[15px] font-semibold text-white"
                  : "w-[72px] rounded-lg border border-transparent bg-white/10 px-3 py-2.5 text-[15px] font-semibold text-white"
              }
            >
              {s}%
            </button>
          ))}
          <input
            inputMode="decimal"
            placeholder="Custom %"
            value={customSlippageInput}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (!/^\d*\.?\d*$/.test(v)) return;
              setCustomSlippageInput(v);
              const n = Number(v);
              if (v !== "" && n >= MIN_SLIPPAGE && n <= MAX_SLIPPAGE)
                setSlippage(n);
            }}
            className={
              customSlippageInput
                ? "w-[96px] rounded-lg border border-icy-blue-400 bg-white/10 px-3 py-2.5 text-center text-[15px] font-semibold text-white placeholder:text-daintree-400 focus:outline-none"
                : "w-[96px] rounded-lg border border-transparent bg-white/10 px-3 py-2.5 text-center text-[15px] font-semibold text-white placeholder:text-daintree-400 focus:outline-none"
            }
          />
        </div>
        {customSlippageInput !== "" &&
          (Number(customSlippageInput) < MIN_SLIPPAGE ||
            Number(customSlippageInput) > MAX_SLIPPAGE) && (
            <p className="pt-2 text-xs font-medium text-red-500">
              Enter a value between {MIN_SLIPPAGE}% and {MAX_SLIPPAGE}%
            </p>
          )}
      </BottomSheet>

      <BottomSheet
        title="Est. Fee"
        subtitle="The estimated total cost for this transaction"
        open={sheet === "fee"}
        onClose={() => setSheet(undefined)}
      >
        {/* "Swap fees" row (in the design) is hidden until the quote carries DEX fee data. */}
        <FeeRow
          label="Network fees"
          value={
            networkFeeWei !== undefined
              ? `${formatAmount(Number(formatEther(networkFeeWei)))} ${nativeSymbol}`
              : "-"
          }
        />
        <SwapFeeSummary
          kastleFee={kastleFee}
          kastleFeeSymbol={kastleFeeSymbol}
          kastleFeeBps={kastleFeeBps}
        />
      </BottomSheet>
    </div>
  );
}
