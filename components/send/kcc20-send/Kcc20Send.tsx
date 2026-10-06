import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatUnits, parseUnits } from "viem";
import PageHeader from "@/ui/general/PageHeader";
import Button from "@/ui/general/Button";
import SendConfirmPage from "@/ui/popup/kcc20/SendConfirmPage";
import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import {
  BuiltKcc20Transfer,
  buildKcc20Transfer,
  Kcc20TransferError,
  sendKcc20Transfer,
} from "@/lib/kcc20/transfer";

type Step = "details" | "confirm" | "success" | "fail";

const KAS_DECIMALS = 8;

export default function Kcc20Send() {
  const navigate = useNavigate();
  const { covenantId } = useParams();
  const { account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const signer = useKaspaHotWalletSigner();
  const { data: tokens, isLoading } = useKcc20Tokens(account?.address);
  const token = tokens?.find((t) => t.covenantId === covenantId);

  const [step, setStep] = useState<Step>("details");
  const [recipient, setRecipient] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [built, setBuilt] = useState<BuiltKcc20Transfer>();
  // Snapshot at build time: SWR drops a fully-spent token, which must not change the confirm/success display.
  const [sent, setSent] = useState<{ decimals: number; symbol: string }>();
  const [txId, setTxId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const onClose = () => navigate("/dashboard");
  const decimals = token?.meta?.decimals ?? 0;
  const symbol = token?.meta?.symbol ?? "";

  const parseAmount = () => {
    try {
      const value = parseUnits(amountInput.trim(), decimals);
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const amount = parseAmount();

  const onReview = async () => {
    if (!token?.meta || !account || !rpcClient || amount === undefined) return;
    const { decimals, symbol } = token.meta;
    setBusy(true);
    setError(undefined);
    try {
      const result = await buildKcc20Transfer({
        token,
        address: account.address,
        recipient: recipient.trim(),
        amount,
        rpc: rpcClient,
      });
      setSent({ decimals, symbol });
      setBuilt(result);
      setStep("confirm");
    } catch (e) {
      setError(
        e instanceof Kcc20TransferError
          ? e.message
          : "Could not build the transfer",
      );
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (busy || !built || !signer || !rpcClient) return;
    setBusy(true);
    try {
      setTxId(await sendKcc20Transfer(signer, built, rpcClient));
      setStep("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transfer failed");
      setStep("fail");
    } finally {
      setBusy(false);
    }
  };

  if (step === "details" && !token?.meta) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Send" onBack={onClose} />
        <p className="px-4 py-8 text-center text-sm text-daintree-400">
          {isLoading ? "Loading token..." : "This token cannot be sent."}
        </p>
      </div>
    );
  }

  if (step === "confirm" && built && sent && account) {
    return (
      <SendConfirmPage
        senderAddress={account.address}
        recipientAddress={recipient.trim()}
        network="kcc20"
        amount={`${formatUnits(built.amount, sent.decimals)} ${sent.symbol}`}
        estFee={`${formatUnits(built.fee, KAS_DECIMALS)} KAS`}
        isConfirmDisabled={!signer}
        isConfirmLoading={busy}
        onConfirm={onConfirm}
        onBack={() => setStep("details")}
        onClose={onClose}
      />
    );
  }

  if (step === "success" || step === "fail") {
    const explorer = explorerTxLinks[networkId ?? NetworkType.Mainnet];
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title={step === "success" ? "Sent" : "Failed"}
          onClose={onClose}
          showClose
        />
        <div className="flex flex-col gap-4 px-4 py-8 text-center">
          {step === "success" ? (
            <>
              <span className="text-base text-white">
                {built &&
                  sent &&
                  `${formatUnits(built.amount, sent.decimals)} ${sent.symbol}`}{" "}
                sent
              </span>
              {txId && (
                <a
                  className="break-all text-sm text-daintree-300 underline"
                  href={`${explorer}${txId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {txId}
                </a>
              )}
            </>
          ) : (
            <span className="break-words text-sm text-daintree-300">
              {error}
            </span>
          )}
          {step === "fail" && (
            // Back to details, not confirm: the built tx may be stale, so Review rebuilds it.
            <Button
              variant="primary"
              size="md"
              onClick={() => setStep("details")}
            >
              Try again
            </Button>
          )}
          <Button
            variant={step === "fail" ? "secondary" : "primary"}
            size="md"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (!token?.meta) return null;
  // Only ADDRESS-owned pieces are sendable; the dashboard balance may be higher.
  const spendable = formatUnits(token.spendable, decimals);
  const inputClass =
    "w-full rounded-xl border border-search-border bg-daintree-800 p-3 text-base text-white placeholder-daintree-300 focus:ring-0";
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={`Send ${symbol}`} onBack={onClose} />
      <div className="flex flex-1 flex-col gap-3 px-4">
        <input
          className={inputClass}
          placeholder="Recipient address (kaspa:q...)"
          autoComplete="off"
          spellCheck={false}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={`Amount (spendable ${spendable} ${symbol})`}
          inputMode="decimal"
          autoComplete="off"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
        />
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      <div className="px-4 pb-6 pt-3">
        <Button
          variant="primary"
          size="md"
          disabled={!recipient.trim() || amount === undefined}
          loading={busy}
          onClick={onReview}
        >
          Review
        </Button>
      </div>
    </div>
  );
}
