import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useSWR from "swr";
import { parseUnits } from "viem";
import { finalize, runSubmission } from "@kassealhq/sdk";
import PageHeader from "@/ui/general/PageHeader";
import Button from "@/ui/general/Button";
import TradePanel from "@/ui/popup/kasseal/TradePanel";
import QuoteSummary from "@/ui/popup/kasseal/QuoteSummary";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useAnalytics from "@/hooks/useAnalytics";
import {
  fetchTxStatus,
  kassealBaseUrl,
  kassealNetworkOf,
  postTx,
} from "@/lib/kasseal/api";
import { useKassealToken } from "@/lib/kasseal/useKassealTokens";
import {
  kassealBuilder,
  useKassealMarket,
  useKassealQuote,
} from "@/lib/kasseal/useKassealQuote";
import {
  buildTrade,
  KassealQuote,
  KassealSide,
  kassealSubmissionEffects,
} from "@/lib/kasseal/trade";
import { signKassealTx } from "@/lib/kasseal/sign";
import { kassealErrorCopy } from "@/lib/kasseal/errorCopy";
import { formatKas, formatTokenAmount, KAS_DECIMALS } from "./format";

type Step = "form" | "confirm" | "submitting" | "success" | "fail";

function parseAmount(input: string, decimals: number): bigint | undefined {
  if (!/^\d*\.?\d*$/.test(input) || !input || input === ".") return undefined;
  // parseUnits rounds excess decimals; refuse them instead.
  if ((input.split(".")[1]?.length ?? 0) > decimals) return undefined;
  return parseUnits(input, decimals);
}

export default function KassealTrade() {
  const navigate = useNavigate();
  const { covenantId } = useParams();
  const { networkId } = useRpcClientStateful();
  const network = kassealNetworkOf(networkId);
  const { account } = useWalletManager();
  const signer = useKaspaHotWalletSigner();
  const { emitKassealTradeCompleted } = useAnalytics();
  const { data: token, mutate: refreshToken } = useKassealToken(covenantId);

  const { data: ownKey } = useSWR(
    signer && account ? ["kassealOwnKey", account.address] : null,
    async () => (await signer!.getPublicKey()).toXOnlyPublicKey().toString(),
  );
  const market = useKassealMarket(network, token, ownKey);

  const [step, setStep] = useState<Step>("form");
  const [side, setSide] = useState<KassealSide>("buy");
  const [amountInput, setAmountInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [reviewed, setReviewed] = useState<KassealQuote>();
  const [txId, setTxId] = useState<string>();
  const [error, setError] = useState<string>();

  const amountIn = token
    ? parseAmount(amountInput, side === "buy" ? KAS_DECIMALS : token.decimals)
    : undefined;
  const { quote, error: quoteError } = useKassealQuote(
    side,
    token,
    market.data,
    amountIn,
    slippageBps,
  );

  const back = () => navigate(`/kasseal/${covenantId}`);
  const fmtIn = (q: KassealQuote) =>
    q.side === "buy"
      ? formatKas(q.amountIn)
      : formatTokenAmount(q.amountIn, token!);
  const fmtOut = (v: bigint, s: KassealSide) =>
    s === "buy" ? formatTokenAmount(v, token!) : formatKas(v);

  const submit = async () => {
    const proof = market.data?.proof;
    if (!reviewed || !proof || !network || !signer || !account || !ownKey)
      return;
    setStep("submitting");
    const baseUrl = kassealBaseUrl(network);
    const xOnlyPubkey = Uint8Array.from(
      ownKey.match(/../g)!.map((b) => parseInt(b, 16)),
    );
    try {
      const result = await runSubmission(
        kassealSubmissionEffects({
          makeBuilder: (required) =>
            kassealBuilder(network, proof.tokenId, ownKey, required),
          build: (builder) =>
            buildTrade(
              builder,
              proof,
              { address: account.address, xOnlyPubkey },
              reviewed,
            ),
          sign: async (built) =>
            finalize(built, await signKassealTx(signer, built)),
          post: (built) => postTx(baseUrl, built.txid, built.txJson),
          status: (txid) => fetchTxStatus(baseUrl, txid),
        }),
      );
      const { outcome } = result;
      if (outcome.kind === "give-up") throw new Error(outcome.reason);
      setTxId(outcome.kind === "done" ? outcome.txid : outcome.newTxid);
      setStep("success");
      emitKassealTradeCompleted({
        status: "success",
        side: reviewed.side,
        venue: reviewed.venue,
        covenantId: proof.tokenId,
        sender: account.address,
      });
      void refreshToken();
    } catch (e) {
      setError(kassealErrorCopy(e));
      setStep("fail");
      emitKassealTradeCompleted({
        status: "failed",
        side: reviewed.side,
        venue: reviewed.venue,
        covenantId: proof.tokenId,
        sender: account.address,
      });
    }
  };

  if (step === "success" || step === "fail") {
    const explorer = explorerTxLinks[networkId ?? NetworkType.Mainnet];
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title={
            step === "success" ? KASSEAL_LABELS.success : KASSEAL_LABELS.failed
          }
          onBack={back}
        />
        <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
          {step === "fail" && (
            <p className="text-sm text-daintree-400">{error}</p>
          )}
          {txId && (
            <a
              href={`${explorer}${txId}`}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm text-icy-blue-400"
            >
              {KASSEAL_LABELS.viewInExplorer}
            </a>
          )}
          <div className="mt-auto">
            <Button
              size="lg"
              onClick={() => {
                setStep("form");
                setReviewed(undefined);
                if (step === "success") back();
              }}
            >
              {step === "success"
                ? KASSEAL_LABELS.done
                : KASSEAL_LABELS.tryAgain}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if ((step === "confirm" || step === "submitting") && reviewed && token) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title={KASSEAL_LABELS.confirm}
          onBack={() => step === "confirm" && setStep("form")}
        />
        <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
          <QuoteSummary
            side={reviewed.side}
            pay={fmtIn(reviewed)}
            receive={fmtOut(reviewed.amountOut, reviewed.side)}
            bound={
              reviewed.side === "buy" && reviewed.venue === "curve"
                ? formatKas(reviewed.bound)
                : fmtOut(reviewed.bound, reviewed.side)
            }
            fee={formatKas(reviewed.feeSompi)}
            slippage={`${slippageBps / 100}%`}
          />
          <div className="mt-auto">
            <Button
              size="lg"
              loading={step === "submitting"}
              disabled={step === "submitting"}
              onClick={submit}
            >
              {step === "submitting"
                ? KASSEAL_LABELS.submitting
                : KASSEAL_LABELS.confirm}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const marketError = market.error ? kassealErrorCopy(market.error) : undefined;
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={token?.ticker ?? KASSEAL_LABELS.trade} onBack={back} />
      <div className="flex flex-1 flex-col px-4 pb-4">
        {market.isLoading && (
          <p className="pb-4 text-center text-sm text-daintree-400">
            {KASSEAL_LABELS.verifying}
          </p>
        )}
        <TradePanel
          side={side}
          onSideChange={setSide}
          amount={amountInput}
          onAmountChange={setAmountInput}
          unit={side === "buy" ? "KAS" : (token?.ticker ?? "")}
          estimate={quote ? fmtOut(quote.amountOut, quote.side) : undefined}
          slippageBps={slippageBps}
          onSlippageChange={setSlippageBps}
          error={
            marketError ??
            (quoteError ? kassealErrorCopy(quoteError) : undefined)
          }
          canReview={!!quote && !!market.data && !!signer}
          onReview={() => {
            setReviewed(quote);
            setStep("confirm");
          }}
        />
      </div>
    </div>
  );
}
