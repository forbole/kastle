import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useSWR from "swr";
import { parseUnits } from "viem";
import { errorCode, finalize } from "@kassealhq/sdk";
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
  boundKind,
  buildTrade,
  kassealAttemptOpen,
  KassealIntent,
  KassealQuote,
  KassealSide,
  matchesKassealIntent,
  newKassealAttempt,
  settleKassealAttempt,
  submitKassealTrade,
} from "@/lib/kasseal/trade";
import {
  clearKassealAttempt,
  kassealAttemptKey,
  loadKassealAttempt,
  saveKassealAttempt,
} from "@/lib/kasseal/attempts";
import { signKassealTx } from "@/lib/kasseal/sign";
import {
  kassealErrorCopy,
  kassealOpenAttemptCopy,
} from "@/lib/kasseal/errorCopy";
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
  // Survives "Try again" and, via storage, a closed popup: a retry checks
  // earlier POSTs and reuses their coins.
  const attempt = useRef(newKassealAttempt());
  // The open attempt's trade; the form refuses any other until it settles.
  const [lock, setLock] = useState<KassealIntent>();
  const [attemptReady, setAttemptReady] = useState(false);
  const attemptKey =
    network && account && covenantId
      ? kassealAttemptKey(network, account.address, covenantId)
      : undefined;

  useEffect(() => {
    attempt.current = newKassealAttempt();
    setLock(undefined);
    setAttemptReady(false);
    if (!attemptKey || !network) return;
    let live = true;
    (async () => {
      const stored = await loadKassealAttempt(attemptKey).catch(
        () => undefined,
      );
      const outcome = stored
        ? await settleKassealAttempt(stored, (txid) =>
            fetchTxStatus(kassealBaseUrl(network), txid),
          )
        : "not-sent";
      if (outcome !== "open") {
        if (stored) await clearKassealAttempt(attemptKey).catch(() => {});
      } else if (live) {
        attempt.current = stored!;
        setLock(stored!.intent);
        if (stored!.intent) {
          setSide(stored!.intent.side);
          setAmountInput(stored!.intent.input);
        }
      }
      if (live) setAttemptReady(true);
    })();
    return () => {
      live = false;
    };
  }, [attemptKey, network]);

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

  const lockRefused =
    !!lock &&
    !!quote &&
    !matchesKassealIntent(lock, side, quote.venue, amountIn);

  const back = () => navigate(`/kasseal/${covenantId}`);
  const fmtIn = (q: KassealQuote) =>
    q.side === "buy"
      ? formatKas(q.amountIn, { exact: true })
      : formatTokenAmount(q.amountIn, token!, { exact: true });
  const fmtOut = (v: bigint, s: KassealSide, exact = false) =>
    s === "buy"
      ? formatTokenAmount(v, token!, { exact })
      : formatKas(v, { exact });

  const submit = async () => {
    const proof = market.data?.proof;
    if (
      !reviewed ||
      !proof ||
      !network ||
      !signer ||
      !account ||
      !ownKey ||
      !attemptKey ||
      amountIn === undefined
    )
      return;
    setStep("submitting");
    const key = attemptKey;
    const current = attempt.current;
    current.intent ??= {
      side: reviewed.side,
      venue: reviewed.venue,
      amount: amountIn,
      input: amountInput,
    };
    const settled = () => {
      attempt.current = newKassealAttempt();
      setLock(undefined);
      void clearKassealAttempt(key).catch(() => {});
    };
    const baseUrl = kassealBaseUrl(network);
    const xOnlyPubkey = Uint8Array.from(
      ownKey.match(/../g)!.map((b) => parseInt(b, 16)),
    );
    try {
      const txid = await submitKassealTrade(
        {
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
          persist: (a) => saveKassealAttempt(key, a),
        },
        current,
      );
      settled();
      setTxId(txid);
      setStep("success");
      emitKassealTradeCompleted({
        status: "success",
        side: reviewed.side,
        venue: reviewed.venue,
        covenantId: proof.tokenId,
        sender: account.address,
      });
      void refreshToken();
      void market.refresh();
    } catch (e) {
      // Nothing posted, or the pinned coins are spent: the outcome is known.
      if (
        !kassealAttemptOpen(current) ||
        errorCode(e) === "PINNED_FUNDING_GONE"
      )
        settled();
      else setLock(current.intent);
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
            boundKind={boundKind(reviewed)}
            pay={fmtIn(reviewed)}
            receive={fmtOut(reviewed.amountOut, reviewed.side)}
            bound={
              boundKind(reviewed) === "max-paid"
                ? formatKas(reviewed.bound, { exact: true })
                : fmtOut(reviewed.bound, reviewed.side, true)
            }
            fee={formatKas(reviewed.feeSompi, { exact: true })}
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
            (lockRefused
              ? kassealOpenAttemptCopy(lock, token?.ticker ?? "")
              : undefined) ??
            marketError ??
            (quoteError ? kassealErrorCopy(quoteError) : undefined)
          }
          canReview={
            !!quote && !!market.data && !!signer && attemptReady && !lockRefused
          }
          onReview={() => {
            setReviewed(quote);
            setStep("confirm");
          }}
        />
      </div>
    </div>
  );
}
