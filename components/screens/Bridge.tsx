import React, { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Hex,
  PublicClient,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  http,
  numberToHex,
  parseEther,
  stringToHex,
} from "viem";
import GeneralHeader from "@/components/GeneralHeader";
import toast from "@/components/Toast";
import {
  AmountInput,
  BottomSheet,
  ConfirmButton,
  QuoteRow,
  SheetToken,
  Skeleton,
  TermsGate,
  TokenPill,
  TokenSheet,
  formatAmount,
} from "@/components/swap-bridge/ui";
import BottomNav from "@/components/BottomNav";
import kaspaIcon from "@/assets/images/network-logos/kaspa.svg";
import { NetworkType } from "@/contexts/SettingsContext";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import useFeeEstimateByGas from "@/hooks/evm/useFeeEstimateByGas";
import { useKasFeeEstimate } from "@/hooks/useKasFeeEstimate";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import {
  BRIDGE_ROUTES,
  BRIDGE_TOKEN_NAME,
  BridgeChain,
  BridgeDirection,
  IGRA_ENTRY_ADDRESS,
  KASPLEX_BRIDGE_CONTRACT,
  KASTLE_FEE_ADDRESS,
  KURVE_ENTRY_ADDRESS,
  KURVE_SERVICE_FEE,
  KASPLEX_EXIT_FEE_RATE,
  bridgeDirectionsFrom,
  igraEntryPayload,
  validateKasToIgra,
  validateKasToKasplex,
} from "@/lib/bridge/bridge";
import {
  EXIT_GATE_MESSAGES,
  computeContractFeeWei,
  computeMaxExitKas,
  evaluateExitGate,
  mapExitRevertToMessage,
  readExitGateValues,
  validateKaspaPayoutAddress,
  validateKurveExitAmount,
} from "@/lib/bridge/exit-liquidity";
import {
  FEE_COLLECTOR_BRIDGE_ABI,
  KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS,
} from "@/lib/bridge/fee-collector";
import {
  IGRA_EXIT_BRIDGE_ABI,
  IGRA_EXIT_BRIDGE_MAINNET,
  IGRA_KAS_VAULT_MAINNET,
} from "@/lib/bridge/igra-exit-abi";
import { KASPLEX_BRIDGE_ABI } from "@/lib/bridge/kurve-abi";
import { BRIDGE_SUBMITTED_MESSAGE } from "@/lib/bridge/messages";
import { mineIgraEntry } from "@/lib/bridge/igra-entry";
import {
  igraMainnet,
  igraTestnet,
  kasplexMainnet,
  kasplexTestnet,
} from "@/lib/layer2";
import { sendEvmTransaction } from "@/lib/ethereum/transaction";
import { bridgeReceived, l1BridgeSplit } from "@/lib/swap-bridge-quote";
import { createTransactions, kaspaToSompi } from "@/wasm/core/kaspa";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";

// ponytail: display-only gas for the fee row; the send path estimates for real.
const EVM_BRIDGE_GAS = 150_000n;
const REVERSE: Record<BridgeDirection, BridgeDirection> = {
  "kas-igra": "igra-kas",
  "igra-kas": "kas-igra",
  "kas-kasplex": "kasplex-kas",
  "kasplex-kas": "kas-kasplex",
};
const CHAIN_LABEL: Record<BridgeChain, string> = {
  kaspa: "Kaspa",
  kasplex: "Kasplex",
  igra: "Igra",
};

const TOOLTIPS = {
  provider: {
    title: "Provider",
    body: "The bridge that handles your cross-chain transfer and ensures the funds are delivered to the destination chain.",
  },
  minReceived: {
    title: "Min Received",
    body: "The estimated minimum amount you'll receive on the destination chain after bridge fees are deducted.",
    footer:
      "The actual amount may vary slightly depending on network conditions.",
  },
  estTime: {
    title: "Est. Time",
    body: "The estimated time for your assets to arrive on the destination chain.",
    footer:
      "Timing may vary depending on network congestion and confirmation speed.",
  },
};

export default function Bridge() {
  const { rpcClient, networkId } = useRpcClientStateful();
  const isMainnet = (networkId ?? NetworkType.Mainnet) === NetworkType.Mainnet;
  const net = isMainnet ? "mainnet" : "testnet";
  const { account, wallet } = useWalletManager();
  const evmAddress = useEvmAddress();
  const evmSigner = useEvmHotWalletSigner();
  const kaspaSigner = useKaspaHotWalletSigner();
  const { kaspaPrice } = useKaspaPrice();

  const evmChains = {
    kasplex: isMainnet ? kasplexMainnet : kasplexTestnet,
    igra: isMainnet ? igraMainnet : igraTestnet,
  };
  const chainImage = (c: BridgeChain) =>
    c === "kaspa" ? kaspaIcon : evmChains[c].icon;
  const hexOf = (c: "kasplex" | "igra") => numberToHex(evmChains[c].id) as Hex;

  const [picked, setDirection] = useState<BridgeDirection>("kas-igra");
  // A mainnet-only route picked before switching to testnet falls back.
  const direction =
    !isMainnet && BRIDGE_ROUTES[picked].mainnetOnly ? "kas-igra" : picked;
  const route = BRIDGE_ROUTES[direction];
  const [amount, setAmount] = useState("");
  const [sheet, setSheet] = useState<"token" | "provider" | "fee">();
  const [sheetChain, setSheetChain] = useState<BridgeChain>(route.from);
  const [submitting, setSubmitting] = useState(false);

  const kaspaBalance = useKaspaBalance(account?.address);
  const { data: kasplexBalance } = useEvmKasBalance(hexOf("kasplex"));
  const { data: igraBalance } = useEvmKasBalance(hexOf("igra"));
  const balanceOf = (c: BridgeChain) =>
    c === "kaspa"
      ? kaspaBalance
      : c === "kasplex"
        ? kasplexBalance && Number(kasplexBalance.balance)
        : igraBalance && Number(igraBalance.balance);
  const balance = balanceOf(route.from);

  const { fee: l1FeeSompi } = useKasFeeEstimate({ extraOutputCount: 1 });
  const evmFrom = route.from === "kaspa" ? undefined : route.from;
  const { data: evmFeeWei } = useFeeEstimateByGas(
    evmFrom ? EVM_BRIDGE_GAS : undefined,
    evmFrom ? hexOf(evmFrom) : undefined,
  );
  const networkFee =
    route.from === "kaspa"
      ? l1FeeSompi !== undefined
        ? l1FeeSompi / 1e8
        : undefined
      : evmFeeWei !== undefined
        ? Number(formatEther(evmFeeWei))
        : undefined;

  const igraClient = useMemo(
    () =>
      createPublicClient({
        chain: igraMainnet,
        transport: http(),
      }) as unknown as PublicClient,
    [],
  );
  // igra-kas limits and fees live on-chain.
  const { data: exitParams } = useSWR(
    direction === "igra-kas" ? "igraExitParams" : null,
    async () => {
      const read = (functionName: string) =>
        igraClient.readContract({
          address: IGRA_EXIT_BRIDGE_MAINNET,
          abi: IGRA_EXIT_BRIDGE_ABI,
          functionName,
        } as Parameters<PublicClient["readContract"]>[0]) as Promise<bigint>;
      const [feeRate, feePercentBps, minFeeFloor, minExit, maxExit] =
        await Promise.all([
          igraClient
            .readContract({
              address: KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS,
              abi: FEE_COLLECTOR_BRIDGE_ABI,
              functionName: "feeRate",
            })
            .catch(() => 75n),
          read("feePercentBps"),
          read("MIN_FEE_FLOOR"),
          read("MIN_EXIT_AMOUNT"),
          read("maxExitAmount"),
        ]);
      return { feeRate, feePercentBps, minFeeFloor, minExit, maxExit };
    },
    { refreshInterval: 30_000 },
  );

  const amountNum = Number(amount) || 0;
  const igraExit = (() => {
    if (!exitParams || amountNum <= 0) return undefined;
    const netWei =
      (parseEther(amount) * (10_000n - exitParams.feeRate)) / 10_000n;
    const upstreamFeeWei = computeContractFeeWei(
      netWei,
      exitParams.feePercentBps,
      exitParams.minFeeFloor,
    );
    return {
      feeRateBps: Number(exitParams.feeRate),
      upstreamFeeKas: Number(formatEther(upstreamFeeWei)),
    };
  })();
  const received =
    amountNum > 0 ? bridgeReceived(direction, amountNum, igraExit) : undefined;

  const fees = (() => {
    if (amountNum <= 0) return undefined;
    switch (direction) {
      case "kas-igra":
        return { bridge: 0, kastle: l1BridgeSplit(amountNum).kastleFee };
      case "kas-kasplex":
        return {
          bridge: KURVE_SERVICE_FEE,
          kastle: l1BridgeSplit(amountNum).kastleFee,
        };
      case "kasplex-kas":
        return { bridge: amountNum * KASPLEX_EXIT_FEE_RATE, kastle: 0 };
      case "igra-kas":
        return igraExit
          ? {
              bridge: igraExit.upstreamFeeKas,
              kastle: (amountNum * igraExit.feeRateBps) / 10_000,
            }
          : undefined;
    }
  })();
  const fromSymbol = BRIDGE_TOKEN_NAME[route.from];
  const toSymbol = BRIDGE_TOKEN_NAME[route.to];

  const error = (() => {
    if (wallet?.type === "ledger")
      return "Ledger doesn’t support bridge currently.";
    if (amountNum <= 0 || balance === undefined || networkFee === undefined)
      return undefined;
    const ctx = { balance, networkFee, isMainnet };
    switch (direction) {
      case "kas-igra":
        return validateKasToIgra(amountNum, ctx);
      case "kas-kasplex":
        return validateKasToKasplex(amountNum, ctx);
      case "kasplex-kas":
      case "igra-kas": {
        if (direction === "kasplex-kas") {
          const min = validateKurveExitAmount(amountNum);
          if (min) return min;
        } else if (exitParams) {
          const rate = Number(exitParams.feeRate) / 10_000;
          const minNet = Number(
            formatEther(
              exitParams.minExit > exitParams.minFeeFloor
                ? exitParams.minExit
                : exitParams.minFeeFloor,
            ),
          );
          const minGross = Math.ceil((minNet / (1 - rate)) * 100) / 100;
          if (amountNum < minGross)
            return `Oh, minimum bridge amount is ${minGross} ${fromSymbol}`;
        }
        if (amountNum > balance) return "Oh, you don't have enough funds";
        if (amountNum + networkFee > balance)
          return `Oh, you need ${fromSymbol} for the network fees`;
        if (direction === "igra-kas" && exitParams) {
          const max = computeMaxExitKas({
            balanceKas: balance,
            capHeadroomKas: null,
            maxExitAmountKas: Number(formatEther(exitParams.maxExit)),
            feeRateBps: Number(exitParams.feeRate),
          });
          if (amountNum > max)
            return `Oh, bridge supports exits up to ${formatAmount(max, 2)} ${fromSymbol}`;
        }
        return undefined;
      }
    }
  })();

  const bridgeL1 = async () => {
    if (!rpcClient || !networkId || !account || !kaspaSigner || !evmAddress)
      throw new Error("Wallet not ready");
    const { entries } = await rpcClient.getUtxosByAddresses([account.address]);
    const { kastleFee } = l1BridgeSplit(amountNum);
    const feeSompi = kaspaToSompi(kastleFee.toFixed(8));
    const amountSompi = kaspaToSompi(amount);
    if (!feeSompi || !amountSompi) throw new Error("Invalid amount");
    const entrySompi = amountSompi - feeSompi;
    const isIgra = direction === "kas-igra";
    const payload = isIgra
      ? igraEntryPayload(evmAddress, entrySompi)
      : stringToHex(evmAddress).slice(2);
    const { transactions } = await createTransactions({
      entries,
      outputs: [
        {
          address: (isIgra ? IGRA_ENTRY_ADDRESS : KURVE_ENTRY_ADDRESS)[net],
          amount: entrySompi,
        },
        { address: KASTLE_FEE_ADDRESS[net], amount: feeSompi },
      ],
      priorityFee: 0n,
      changeAddress: account.address,
      networkId,
      payload,
    });
    if (!isIgra) {
      // The payment is the last transaction of the batch.
      await signAndSubmitBatch(transactions, kaspaSigner, rpcClient);
      return;
    }
    if (transactions.length !== 1)
      throw new Error("IGRA bridge amount exceeds single-transaction limit");
    const mined = mineIgraEntry(
      transactions[0].serializeToSafeJSON(),
      payload,
      isMainnet,
    );
    const signed = await kaspaSigner.signTx(mined);
    signed.finalize();
    // Signatures are not part of the id; fail closed if that ever changes,
    // an entry without the prefix is never credited.
    if (signed.id !== mined.id) throw new Error("IGRA entry id changed");
    await rpcClient.submitTransaction({
      transaction: signed,
      allowOrphan: false,
    });
  };

  const bridgeL2 = async () => {
    if (!evmSigner || !evmAddress || !account || !evmFrom)
      throw new Error("Wallet not ready");
    const chain = evmChains[evmFrom];
    const client = createPublicClient({
      chain,
      transport: http(),
    }) as unknown as PublicClient;
    const value = parseEther(amount);
    let to: Hex;
    let data: Hex;
    if (direction === "kasplex-kas") {
      to = KASPLEX_BRIDGE_CONTRACT[net];
      data = encodeFunctionData({
        abi: KASPLEX_BRIDGE_ABI,
        functionName: "lockForBridge",
        args: [stringToHex(account.address)],
      });
    } else {
      const addressError = validateKaspaPayoutAddress(account.address);
      if (addressError) throw new Error(addressError);
      let feeRate: bigint;
      try {
        feeRate = await client.readContract({
          address: KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS,
          abi: FEE_COLLECTOR_BRIDGE_ABI,
          functionName: "feeRate",
        });
      } catch {
        throw new Error(EXIT_GATE_MESSAGES.unavailable);
      }
      const gate = evaluateExitGate(
        await readExitGateValues({
          client,
          bridgeAddress: IGRA_EXIT_BRIDGE_MAINNET,
          netWei: (value * (10_000n - feeRate)) / 10_000n,
          getVaultBalanceSompi: async () =>
            (
              await rpcClient!.getBalanceByAddress({
                address: IGRA_KAS_VAULT_MAINNET,
              })
            ).balance,
        }),
      );
      if (!gate.ok) throw new Error(gate.message);
      if (gate.notice) toast.info(gate.notice);
      to = KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS;
      data = encodeFunctionData({
        abi: FEE_COLLECTOR_BRIDGE_ABI,
        functionName: "bridgeToL1",
        args: [account.address],
      });
    }
    const gas = await client.estimateGas({
      account: evmAddress,
      to,
      data,
      value,
    });
    await sendEvmTransaction({
      ethClient: client,
      signer: evmSigner,
      sender: evmAddress,
      to,
      valueInWei: value,
      gas: (gas * 12n) / 10n,
      chainId: chain.id,
      data,
    });
  };

  const onConfirm = async () => {
    setSubmitting(true);
    toast.info(
      `Bridging ${fromSymbol} on ${CHAIN_LABEL[route.from]} to ${CHAIN_LABEL[route.to]}`,
    );
    try {
      await (route.from === "kaspa" ? bridgeL1() : bridgeL2());
      toast.success(BRIDGE_SUBMITTED_MESSAGE);
      setAmount("");
    } catch (e) {
      console.error(e);
      toast.error(
        mapExitRevertToMessage(e) ??
          (e instanceof Error &&
          (Object.values(EXIT_GATE_MESSAGES) as string[]).includes(e.message)
            ? e.message
            : "Bridge failed. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sheetTokens: SheetToken[] = (
    ["kaspa", "kasplex", "igra"] as BridgeChain[]
  ).map((c) => {
    const b = balanceOf(c);
    return {
      key: c,
      chain: c,
      symbol: BRIDGE_TOKEN_NAME[c],
      chainImage: chainImage(c),
      balance: b === undefined ? undefined : formatAmount(b),
      disabled: bridgeDirectionsFrom(c, isMainnet).length === 0,
    };
  });
  const reverse = REVERSE[direction];
  const canFlip = bridgeDirectionsFrom(route.to, isMainnet).includes(reverse);
  const loadingQuote = direction === "igra-kas" && !exitParams;

  return (
    <div className="flex h-full flex-col">
      <div className="no-scrollbar flex flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4">
        <GeneralHeader title="Bridge" showClose={false} />

        <div className="flex items-center gap-2">
          <TokenPill
            symbol={fromSymbol}
            chainImage={chainImage(route.from)}
            onClick={() => {
              setSheetChain(route.from);
              setSheet("token");
            }}
          />
          <i className="hn hn-arrow-right text-daintree-400" />
          <TokenPill
            symbol={toSymbol}
            chainImage={chainImage(route.to)}
            onClick={() => setSheet("provider")}
          />
        </div>

        <div className="relative">
          <AmountInput
            value={amount}
            onChange={setAmount}
            symbol={fromSymbol}
            usd={
              amountNum > 0
                ? `$${formatAmount(amountNum * kaspaPrice, 2)}`
                : undefined
            }
            balance={balance === undefined ? undefined : formatAmount(balance)}
          />
          <button
            type="button"
            aria-label="Flip"
            disabled={!canFlip}
            onClick={() => {
              setDirection(reverse);
              setAmount("");
            }}
            className="absolute right-0 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 disabled:opacity-40"
          >
            <i className="hn hn-sort text-white" />
          </button>
        </div>

        {amountNum > 0 && (
          <div className="rounded-lg border border-daintree-700 bg-daintree-800 px-4 py-2">
            <QuoteRow label="Min Received" tooltip={TOOLTIPS.minReceived}>
              {received === undefined ? (
                <Skeleton />
              ) : (
                <span className="flex flex-col items-end">
                  {formatAmount(Math.max(received, 0))} {toSymbol}
                  <span className="text-xs text-daintree-400">
                    ≈ ${formatAmount(Math.max(received, 0) * kaspaPrice, 2)}
                  </span>
                </span>
              )}
            </QuoteRow>
            <QuoteRow
              label="Provider"
              tooltip={TOOLTIPS.provider}
              onClick={() => setSheet("provider")}
            >
              {route.provider}
            </QuoteRow>
            <QuoteRow label="Est. Fee" onClick={() => setSheet("fee")}>
              {fees === undefined || networkFee === undefined ? (
                <Skeleton />
              ) : (
                `${formatAmount(fees.bridge + fees.kastle + networkFee)} ${fromSymbol}`
              )}
            </QuoteRow>
            <QuoteRow label="Est. Time" tooltip={TOOLTIPS.estTime}>
              {route.estTime}
            </QuoteRow>
            {(route.from === "kaspa" || direction === "igra-kas") && (
              <p className="mt-1 flex items-center gap-1 border-t border-daintree-700 pt-2 text-xs text-daintree-400">
                <i className="hn hn-info-circle" />
                {route.from === "kaspa"
                  ? "Quote includes 0.2 $KAS + 0.75% Kastle Fee"
                  : "Quote includes 0.75% Kastle Fee"}
              </p>
            )}
          </div>
        )}

        <ConfirmButton
          error={error}
          disabled={
            !!error ||
            amountNum <= 0 ||
            received === undefined ||
            loadingQuote ||
            networkFee === undefined
          }
          loading={submitting}
          onClick={onConfirm}
        />
      </div>
      <BottomNav />
      <TermsGate kind="Bridge" />

      <TokenSheet
        open={sheet === "token"}
        onClose={() => setSheet(undefined)}
        chains={(["kaspa", "kasplex", "igra"] as BridgeChain[]).map((c) => ({
          key: c,
          label: CHAIN_LABEL[c],
        }))}
        chain={sheetChain}
        onChain={(c) => setSheetChain(c as BridgeChain)}
        tokens={sheetTokens}
        onSelect={(t) => {
          const from = t.chain as BridgeChain;
          if (from !== route.from)
            setDirection(bridgeDirectionsFrom(from, isMainnet)[0]);
          setAmount("");
        }}
        recentKey="local:bridge_recent_tokens"
      />

      <BottomSheet
        title="Select Provider"
        open={sheet === "provider"}
        onClose={() => setSheet(undefined)}
      >
        {bridgeDirectionsFrom(route.from, isMainnet).map((d) => {
          const r = BRIDGE_ROUTES[d];
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                setSheet(undefined);
              }}
              className="flex items-center gap-3 rounded-lg border border-daintree-700 p-3 text-left"
            >
              <img
                src={chainImage(r.to)}
                alt=""
                className="size-8 rounded-full"
              />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-semibold text-white">
                  {r.provider}
                </span>
                <span className="text-xs text-daintree-400">
                  {BRIDGE_TOKEN_NAME[r.to]} on {CHAIN_LABEL[r.to]} · {r.estTime}
                </span>
              </div>
              {d === direction && (
                <i className="hn hn-check-circle text-icy-blue-400" />
              )}
            </button>
          );
        })}
      </BottomSheet>

      <BottomSheet
        title="Est. Fee"
        open={sheet === "fee"}
        onClose={() => setSheet(undefined)}
      >
        {[
          ["Bridge fees", fees?.bridge],
          ["Network fees", networkFee],
          ["Kastle fees", fees?.kastle],
        ].map(([label, value]) => (
          <div key={label as string} className="flex justify-between text-sm">
            <span className="text-daintree-400">{label}</span>
            <span className="text-white">
              {value === undefined
                ? "-"
                : `${formatAmount(value as number)} ${fromSymbol}`}
            </span>
          </div>
        ))}
        {route.from === "kaspa" && (
          <p className="text-xs text-daintree-400">
            Quote includes 0.2 KAS + 0.75% Kastle fee
          </p>
        )}
      </BottomSheet>
    </div>
  );
}
