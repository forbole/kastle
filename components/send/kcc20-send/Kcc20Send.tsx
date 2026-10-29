import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import { formatUnits, parseUnits } from "viem";
import Header from "@/components/GeneralHeader";
import {
  TokenSendAsset,
  TokenSendDetails,
} from "@/components/send/krc20-send/DetailsStep";
import { TokenConfirmView } from "@/components/send/krc20-send/ConfirmTokenOperationStep";
import { KRC20SendForm } from "@/components/send/krc20-send/Krc20Send";
import { Broadcasting } from "@/components/send/Broadcasting.tsx";
import { SuccessStatus } from "@/components/send/SuccessStatus.tsx";
import { FailStatus } from "@/components/send/FailStatus.tsx";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useKcc20Tokens from "@/lib/kcc20/useKcc20Tokens";
import { decimalsError } from "@/lib/kcc20";
import { formatUsdAmount } from "@/lib/utils.ts";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import {
  BuiltKcc20Transfer,
  Kcc20TransferError,
  buildKcc20Transfer,
  sendKcc20Transfer,
} from "@/lib/kcc20/transfer";
import { kcc20BuildErrorCopy, kcc20SendErrorCopy } from "./errorCopy";
import { formatBalance } from "./formatBalance";

type Step = "details" | "confirm" | "broadcast" | "success" | "fail";

const KAS_DECIMALS = 8;

export default function Kcc20Send() {
  const navigate = useNavigate();
  const { covenantId } = useParams();
  const [searchParams] = useSearchParams();
  // A token id can have one row per extension commitment; the route names the row.
  const rowExt = searchParams.get("ext");
  const { account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const signer = useKaspaHotWalletSigner();
  const { addRecentAddress } = useRecentAddresses();
  const { kaspaPrice } = useKaspaPrice();
  const { data: tokens, isLoading } = useKcc20Tokens(account?.address);
  const token = tokens?.find(
    (t) =>
      t.covenantId === covenantId &&
      (!rowExt || t.extensionCommitment === rowExt),
  );

  const form = useForm<KRC20SendForm>({
    defaultValues: {
      userInput: "",
      amount: "",
      priority: "medium",
      priorityFee: 0n,
    },
    mode: "onChange",
  });
  const [step, setStep] = useState<Step>("details");
  const [built, setBuilt] = useState<BuiltKcc20Transfer>();
  // Snapshot at build time: SWR drops a fully-spent token, and the recipient
  // input may change mid-build; neither may change what confirm displays.
  const [sent, setSent] = useState<{
    decimals: number;
    symbol: string;
    recipient: string;
    domain?: string;
  }>();
  const [outTxs, setOutTxs] = useState<string[]>();
  const [failReason, setFailReason] = useState<string>();
  const [isConfirming, setIsConfirming] = useState(false);
  // Build failure not tied to a field (RPC, funding): shown above Next, which stays enabled.
  const [buildError, setBuildError] = useState<string>();
  // One build in flight; a second's result would overwrite the first's.
  const building = useRef(false);

  useEffect(() => {
    const sub = form.watch((_, { name }) => {
      if (name === "userInput" || name === "amount") setBuildError(undefined);
    });
    return () => sub.unsubscribe();
  }, [form]);

  const onClose = () => navigate("/dashboard");
  const decimals = token?.meta?.decimals ?? 0;
  const symbol = token?.meta?.symbol ?? "";

  const feeKas = built ? Number(formatUnits(built.fee, KAS_DECIMALS)) : 0;
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(0);
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    feeKas * kaspaPrice,
  );

  // parseUnits rounds excess decimals: "0.6" of a 0-decimal token would send 1.
  const parseAmount = (input: string) => {
    if (decimalsError(input, decimals, symbol)) return undefined;
    try {
      const value = parseUnits(input.trim(), decimals);
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  };

  const asset: TokenSendAsset = {
    name: symbol,
    logo: token?.meta?.logoURI,
    // Only ADDRESS-owned pieces are sendable; the dashboard balance may be higher.
    balance: token ? Number(formatUnits(token.spendable, decimals)) : 0,
    balanceText: token ? formatBalance(token.spendable, decimals) : "0",
    price: 0,
    decimals,
    maxAmount: token ? formatUnits(token.spendable, decimals) : "0",
    validateAmount: (value) => {
      const input = value ?? "";
      const tooPrecise = decimalsError(input, decimals, symbol);
      if (tooPrecise) return tooPrecise;
      const amount = parseAmount(input);
      // Empty, zero or unparsable: Next stays disabled without a message.
      if (amount === undefined) return "";
      if (token && amount > token.spendable) {
        return "Oh, you don’t have enough funds";
      }
      return true;
    },
    label: "KCC-20",
    feeInfo: "KCC-20 fees are calculated when the transfer is built.",
    onNext: async ({ address, domain, amount: amountInput }) => {
      const amount = parseAmount(amountInput ?? "");
      if (!token?.meta || !account || !rpcClient || !address) return;
      if (amount === undefined) return;
      if (building.current || isConfirming) return;
      building.current = true;
      setBuildError(undefined);
      const { decimals, symbol } = token.meta;
      try {
        const result = await buildKcc20Transfer({
          token,
          address: account.address,
          recipient: address,
          amount,
          rpc: rpcClient,
          network: networkId ?? NetworkType.Mainnet,
        });
        setSent({ decimals, symbol, recipient: address, domain });
        setBuilt(result);
        setStep("confirm");
      } catch (e) {
        const message = kcc20BuildErrorCopy(e);
        // On the input field, so editing the recipient re-validates and clears it.
        if (e instanceof Kcc20TransferError && e.code === "invalid-recipient") {
          form.setError("userInput", { message });
        } else {
          setBuildError(message);
        }
      } finally {
        building.current = false;
      }
    },
    nextError: buildError,
  };

  const onConfirm = async () => {
    if (isConfirming || !built || !sent || !signer || !rpcClient) return;
    setIsConfirming(true);
    try {
      const txId = await sendKcc20Transfer(signer, built, rpcClient);
      setOutTxs([txId]);
      await addRecentAddress({
        kaspaAddress: sent.recipient,
        usedAt: Date.now(),
        domain: sent.domain,
      }).catch(console.error);
      setStep("broadcast");
    } catch (e) {
      setFailReason(kcc20SendErrorCopy(e));
      setStep("fail");
    } finally {
      setIsConfirming(false);
    }
  };

  const dust = built ? built.kasDebit - built.fee : 0n;

  return (
    <div className="relative flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" &&
          (token?.meta ? (
            <TokenSendDetails asset={asset} onBack={onClose} />
          ) : (
            <>
              <Header title="Send" onClose={onClose} onBack={onClose} />
              <p className="py-8 text-center text-sm text-daintree-400">
                {isLoading ? "Loading token..." : "This token cannot be sent."}
              </p>
            </>
          ))}
        {step === "confirm" && built && sent && (
          <TokenConfirmView
            recipient={sent.recipient}
            domain={sent.domain}
            tokenName={sent.symbol}
            tokenId={covenantId}
            amount={formatUnits(built.amount, sent.decimals)}
            amountFiat={formatUsdAmount(amountCurrency, amountCurrencyCode)}
            fee={`${formatUnits(built.fee, KAS_DECIMALS)} KAS`}
            feeFiat={formatUsdAmount(feesCurrency, feesCurrencyCode)}
            // Covenant outputs carry KAS dust on top of the fee.
            feeTooltip={
              dust > 0n
                ? `${formatUnits(built.fee, KAS_DECIMALS)} KAS for Kaspa network fees. ${formatUnits(dust, KAS_DECIMALS)} KAS also travels with the token to the recipient.`
                : `${formatUnits(built.fee, KAS_DECIMALS)} KAS for Kaspa network fees.`
            }
            isConfirming={isConfirming}
            onNext={onConfirm}
            // Back to details, not a resend: the built tx may be stale, so Next rebuilds it.
            // Hidden while signing: a rebuild then would race this send's status.
            onBack={isConfirming ? undefined : () => setStep("details")}
          />
        )}
        {step === "broadcast" && (
          <Broadcasting onSuccess={() => setStep("success")} />
        )}
        {step === "success" && (
          <SuccessStatus
            transactionIds={outTxs}
            token={{ name: sent?.symbol ?? symbol }}
          />
        )}
        {step === "fail" && (
          <FailStatus transactionIds={outTxs} reason={failReason} />
        )}
      </FormProvider>
    </div>
  );
}
