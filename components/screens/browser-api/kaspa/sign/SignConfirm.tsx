import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { Address, payToAddressScript } from "@/wasm/core/kaspa";
import { useState } from "react";
import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import DetailsSelector from "@/components/screens/browser-api/kaspa/sign/DetailsSelector";
import { twMerge } from "tailwind-merge";
import { useSettings } from "@/hooks/useSettings";
import { useBoolean } from "usehooks-ts";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import { formatUsdAmount } from "@/lib/utils.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  hasScriptOptions,
  hasZeroOutputCommitment,
} from "@/lib/wallet/sign-script.ts";
import { useDappCovenantDecode } from "@/lib/kcc20/useDappCovenantDecode";
import { CovenantTokenMovements } from "@/ui/popup/browser-api/CovenantTokenMovements";
import { formatBalance } from "@/components/send/kcc20-send/formatBalance";

// Exact sompi -> KAS text; never rounded, so a 2,000-sompi fee is not "0.000".
const KAS_DECIMALS = 8;
const formatKas = (sompi: bigint) =>
  `${formatBalance(sompi, KAS_DECIMALS)} KAS`;
// Mobile's wording (schemas.ts), "site" for this window.
const SITE_STATED_FEE =
  "As stated by the site: an input this wallet doesn't sign carries the site's own amount";
const sompiToFloat = (sompi: bigint) => Number(sompi) / 10 ** KAS_DECIMALS;

const ZERO_OUTPUT_COMMITMENT_ERROR =
  "This request cannot be signed. It uses a Single sighash on an input that has no matching output, so your signature would commit to no outputs at all. Every output, including where your funds go, could be rewritten after you approve.";

const LEDGER_COVENANT_ERROR =
  "Covenant transactions cannot be signed on Ledger.";
const PARTIAL_SIGHASH_COVENANT_ERROR =
  "This request signs with a partial sighash, so the KCC-20 movement shown above could change after you approve.";
const COVENANT_CAVEAT =
  "Kastle verifies the pieces leaving your wallet. It cannot show the token amounts inside the destination covenant.";

// kascov (standard KCC-20) is only consulted on mainnet.
const COVENANT_CAVEAT_OFF_MAINNET =
  "Standard KCC-20 tokens cannot be checked on this network.";

type SignConfirmProps = {
  payload: SignTxPayload;
  confirm: () => void;
  cancel: () => void;
  warning?: string;
};

export default function SignConfirm({
  payload,
  confirm,
  cancel,
  warning,
}: SignConfirmProps) {
  const kaspaPrice = useKaspaPrice();
  const { account, wallet } = useWalletManager();
  const [hideDetails, setHideDetails] = useState(true);
  const [settings, setSettings] = useSettings();
  const { value: isSigning, toggle: toggleIsSigning } = useBoolean(false);

  const transaction = deserializeTransaction(payload.txJson);
  // Checked here rather than by the callers so every screen that renders this
  // confirm blocks it, and the partial-outputs warning can never stand in for it.
  const zeroOutputCommitment = hasZeroOutputCommitment(
    transaction,
    payload.scripts,
  );

  // Version 1+: the KCC-20 pieces this request spends; confirm waits for the decode.
  const covenant = useDappCovenantDecode(payload.txJson, account?.address);
  // Defence in depth: LedgerSignAndBroadcast already refuses version 1+
  // (hasUnsignableFields), but this screen must never invite a Ledger to sign one.
  const ledgerCovenant = covenant.isCovenant && wallet?.type === "ledger";
  // AnyOneCanPay/Single/None do not commit to every input and output: after
  // approval a dApp could swap in another wallet piece under this signature.
  const partialSighashCovenant =
    covenant.isCovenant &&
    hasScriptOptions(payload.scripts) &&
    payload.scripts!.some((o) => o != null && (o.signType ?? "All") !== "All");
  const confirmBlocked =
    ledgerCovenant ||
    partialSighashCovenant ||
    (covenant.isCovenant && covenant.status !== "ready");
  const shownWarning = covenant.isCovenant
    ? [
        warning,
        settings?.networkId === NetworkType.Mainnet
          ? COVENANT_CAVEAT
          : `${COVENANT_CAVEAT} ${COVENANT_CAVEAT_OFF_MAINNET}`,
      ]
        .filter(Boolean)
        .join("\n\n")
    : warning;

  // Inputs the request sent without a UTXO entry: their amount is not known,
  // so neither is the fee nor the balance change. Never counted as 0.
  const unknownInputs = transaction.inputs.flatMap((input, i) =>
    input.utxo === undefined ? [i] : [],
  );
  const unknownAmountReason =
    unknownInputs.length > 0
      ? `Kastle does not have the amount of input${unknownInputs.length > 1 ? "s" : ""} ${unknownInputs.join(", ")}`
      : undefined;

  const inputsAmount = transaction.inputs.reduce(
    (acc, input) => acc + (input.utxo?.amount ?? 0n),
    0n,
  );
  const outputsAmount = transaction.outputs.reduce(
    (acc, output) => acc + output.value,
    0n,
  );

  const accountScript = account
    ? payToAddressScript(new Address(account.address)).toString()
    : undefined;
  // KAS a moved piece carried out to others is already its token row's figure:
  // per piece, the lesser of its value and its non-wallet authorized outputs.
  const carriedOut = covenant.movements.reduce((acc, m) => {
    const out = m.destinations.reduce((sum, d) => {
      const o = transaction.outputs[d.outputIndex];
      return o && o.scriptPublicKey.toString() !== accountScript
        ? sum + o.value
        : sum;
    }, 0n);
    return acc + (m.value < out ? m.value : out);
  }, 0n);
  // Inputs this wallet does not sign: their amounts are the page's word alone.
  const signedByScript = new Set(
    hasScriptOptions(payload.scripts)
      ? payload.scripts!.flatMap((o) => (o == null ? [] : [o.inputIndex]))
      : [],
  );
  const siteStatedFee = transaction.inputs.some(
    (input, i) =>
      input.utxo !== undefined &&
      !signedByScript.has(i) &&
      input.utxo.scriptPublicKey.toString() !== accountScript,
  );

  // Calculate sending amount in output
  const grossSending = transaction.outputs
    .filter((output) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript !== output.scriptPublicKey.toString();
    })
    .reduce((acc, output) => acc + output.value, 0n);
  const sendingAmount = grossSending - carriedOut;

  // undefined when not computable: an input without an amount, or outputs
  // exceeding inputs (an incomplete transaction).
  const fee =
    unknownAmountReason === undefined && inputsAmount >= outputsAmount
      ? inputsAmount - outputsAmount
      : undefined;

  // Calculate user sending amount for current user
  const userSending = transaction.inputs
    .filter((input) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript === input.utxo?.scriptPublicKey.toString();
    })
    .reduce((acc, input) => acc + (input.utxo?.amount ?? 0n), 0n);

  // Calculate receiving amount for current user
  const userReceiving = transaction.outputs
    .filter((output) => {
      if (!account) return false;

      const accountScript = payToAddressScript(
        new Address(account.address),
      ).toString();

      return accountScript === output.scriptPublicKey.toString();
    })
    .reduce((acc, output) => acc + output.value, 0n);

  // An input with no entry could be any wallet's coin: the change is not known.
  const difference =
    unknownAmountReason === undefined ? userReceiving - userSending : undefined;

  const fiatDifference = sompiToFloat(difference ?? 0n) * kaspaPrice.kaspaPrice;
  const fiatAmount = sompiToFloat(sendingAmount) * kaspaPrice.kaspaPrice;
  const fiatFees = sompiToFloat(fee ?? 0n) * kaspaPrice.kaspaPrice;

  const { amount: differenceCurrency, code: differenceCurrencyCode } =
    useCurrencyValue(fiatDifference);
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(fiatAmount);
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      iconColor: "bg-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      iconColor: "bg-yellow-500",
      background: "bg-yellow-800",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === payload.networkId);

  const networkId = settings?.networkId;

  const networkMismatched =
    !!payload.networkId && networkId?.toString() !== payload.networkId;
  const switchNetwork = () => {
    setSettings((prev) => ({
      ...prev,
      networkId: payload.networkId as NetworkType,
    }));
  };

  const onConfirm = async () => {
    if (isSigning || zeroOutputCommitment || confirmBlocked) {
      return;
    }

    toggleIsSigning();
    await confirm();
    toggleIsSigning();
  };

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Header showPrevious={false} showClose={false} title="Confirm" />
        <div className="relative">
          {wallet?.type !== "ledger" && (
            <img
              src={signImage}
              alt="Sign"
              className="mx-auto aspect-[686/240] w-full max-w-[343px]"
            />
          )}
          {wallet?.type === "ledger" && (
            <img src={ledgerSignImage} alt="Sign" className="mx-auto" />
          )}
          <div
            className={twMerge(
              "absolute right-0 top-0 flex items-center gap-2 rounded-full px-2",
              selectedNetwork?.text,
              selectedNetwork?.background,
            )}
          >
            <i
              className={twMerge(
                "rounded-full p-1",
                selectedNetwork?.iconColor,
              )}
            />
            {selectedNetwork?.name}
          </div>
        </div>

        {/* Network mismatch */}
        {networkMismatched && (
          <div className="mt-12 space-y-16 text-center">
            <h3 className="text-xl font-semibold">
              {"You're on a different network than the one required."}
            </h3>
            <button
              onClick={switchNetwork}
              className="rounded-full bg-icy-blue-400 p-5 text-base font-semibold hover:bg-icy-blue-600"
            >
              Switch to {selectedNetwork?.name}
            </button>
          </div>
        )}

        {/* Confirm Content */}
        {!networkMismatched && (
          <>
            {zeroOutputCommitment ? (
              <div
                className="mt-3 whitespace-pre-line rounded-lg border border-red-900 bg-red-800/30 px-4 py-2 text-xs text-red-500"
                role="alert"
              >
                {ZERO_OUTPUT_COMMITMENT_ERROR}
              </div>
            ) : (
              shownWarning && (
                <div className="mt-3 whitespace-pre-line rounded-lg border border-yellow-600 bg-yellow-900/30 px-4 py-2 text-xs text-yellow-400">
                  {shownWarning}
                </div>
              )
            )}
            {ledgerCovenant && (
              <div
                className="mt-3 rounded-lg border border-red-900 bg-red-800/30 px-4 py-2 text-xs text-red-500"
                role="alert"
              >
                {LEDGER_COVENANT_ERROR}
              </div>
            )}
            {covenant.isCovenant && (
              <CovenantTokenMovements
                movements={covenant.movements}
                status={covenant.status}
                network={networkId ?? ""}
              />
            )}
            {partialSighashCovenant && (
              <div
                className="mt-3 rounded-lg border border-red-900 bg-red-800/30 px-4 py-2 text-xs text-red-500"
                role="alert"
              >
                {PARTIAL_SIGHASH_COVENANT_ERROR}
              </div>
            )}
            <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Change to your balance</span>
                  {difference === undefined ? (
                    <UnknownAmount reason={unknownAmountReason} />
                  ) : (
                    <div
                      className={twMerge(
                        "flex flex-col text-right",
                        difference >= 0n ? "text-teal-500" : "text-red-500",
                      )}
                    >
                      <span className="font-medium">
                        {difference >= 0n && "+"}
                        {formatKas(difference)}
                      </span>
                      <span className="text-xs text-daintree-400">
                        {formatUsdAmount(
                          differenceCurrency,
                          differenceCurrencyCode,
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            </ul>
            {/* Result */}
            <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Sending amount</span>
                  <div className="flex flex-col text-right">
                    <span className="font-medium">
                      {formatKas(sendingAmount)}
                    </span>
                    <span className="text-xs text-daintree-400">
                      {formatUsdAmount(amountCurrency, amountCurrencyCode)}
                    </span>
                  </div>
                </div>
              </li>
              <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                <div className="flex w-full items-start justify-between">
                  <span className="font-medium">Fee</span>
                  {fee === undefined ? (
                    <UnknownAmount
                      reason={
                        unknownAmountReason ??
                        "The outputs exceed the inputs, so this transaction is incomplete"
                      }
                    />
                  ) : (
                    <div className="flex flex-col text-right">
                      <span className="font-medium">{formatKas(fee)}</span>
                      <span className="text-xs text-daintree-400">
                        {formatUsdAmount(feesCurrency, feesCurrencyCode)}
                      </span>
                      {siteStatedFee && (
                        <span className="text-xs text-yellow-400">
                          {SITE_STATED_FEE}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            </ul>
            <div className="space-y-4 py-4">
              <span
                className="inline-flex cursor-pointer items-center gap-2 font-semibold text-[#00B1D0]"
                onClick={() => setHideDetails(!hideDetails)}
              >
                Show raw transaction details
                {hideDetails ? (
                  <i className="hn hn-chevron-down h-[14px] w-[14px]" />
                ) : (
                  <i className="hn hn-chevron-up h-[14px] w-[14px]" />
                )}
              </span>

              {!hideDetails && <DetailsSelector payload={payload} />}
            </div>
          </>
        )}
      </div>

      {/* Buttons */}
      {!networkMismatched && (
        <div
          className={twMerge(
            "flex gap-2 text-base font-semibold",
            !hideDetails && "pb-4",
          )}
        >
          <button
            className={twMerge(
              "rounded-full p-5 text-[#7B9AAA]",
              zeroOutputCommitment && "flex-auto bg-daintree-800",
            )}
            onClick={cancel}
          >
            Cancel
          </button>
          {!zeroOutputCommitment && (
            <button
              className={`flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600${
                // Version 0 keeps its exact class list. The separate " " survives
                // prettier-plugin-tailwindcss, which trims a literal's leading space.
                confirmBlocked
                  ? " " + "cursor-not-allowed opacity-50 hover:bg-icy-blue-400"
                  : ""
              }`}
              disabled={confirmBlocked}
              onClick={onConfirm}
            >
              {isSigning ? (
                <div className="flex gap-2">
                  <div
                    className="inline-block size-5 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                    role="status"
                    aria-label="loading"
                  />
                  {wallet?.type === "ledger" && (
                    <span className="text-sm">Please approve on Ledger</span>
                  )}
                </div>
              ) : (
                `Confirm`
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A figure the wallet cannot compute: labelled with why, never shown as 0. */
function UnknownAmount({ reason }: { reason?: string }) {
  return (
    <div className="flex flex-col text-right">
      <span className="font-medium">Not known</span>
      <span className="text-xs text-daintree-400">{reason}</span>
    </div>
  );
}
