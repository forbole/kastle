import useWalletSigner from "@/hooks/useWalletSigner";
import Splash from "@/components/screens/Splash";
import { CommitRevealPayload } from "@/api/background/handlers/kaspa/commitReveal";
import { Fee, buildCommitRevealScript } from "@/lib/krc20.ts";
import { ApiUtils } from "@/api/background/utils";
import { ApiExtensionUtils } from "@/api/extension";
import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import { twMerge } from "tailwind-merge";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import { formatCurrency } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings";
import { NetworkType } from "@/contexts/SettingsContext";
import ScriptDetailsBox from "./ScriptDetailsBox";

export default function HotWalletCommitReveal({
  requestId,
  payload,
}: {
  requestId: string;
  payload: CommitRevealPayload;
}) {
  const walletSigner = useWalletSigner();
  const kaspaPrice = useKaspaPrice();
  const [settings, setSettings] = useSettings();
  const [step, setStep] = useState<string>();
  const [hideDetails, setHideDetails] = useState(true);

  const feesInKas =
    parseFloat(payload.options.revealPriorityFee ?? Fee.Base.toString()) +
    Fee.Base;
  const fiatFees = feesInKas * kaspaPrice.kaspaPrice;
  const { amount: feesCurrency, code: feesCurrencyCode } =
    useCurrencyValue(fiatFees);

  const differenceInKas = -feesInKas;
  const { amount: differenceCurrency, code: differenceCurrencyCode } =
    useCurrencyValue(differenceInKas * kaspaPrice.kaspaPrice);

  const [isPerforming, setIsPerforming] = useState(false);

  const perform = async () => {
    if (!walletSigner) return;

    if (isPerforming) return;

    setIsPerforming(true);
    try {
      const script = buildCommitRevealScript(
        walletSigner.getPublicKey(),
        payload.namespace,
        JSON.parse(payload.data),
      );

      const commitResultPerform = walletSigner.performCommitReveal(
        script,
        payload.options.revealPriorityFee ?? Fee.Base.toString(),
        [],
      );

      let response: {
        commitTxId?: string;
        revealTxId?: string;
      } = {};
      for await (const result of commitResultPerform) {
        setStep(result.status);
        response = {
          commitTxId: result.commitTxId,
          revealTxId: result.revealTxId,
        };
      }

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, response),
      );
    } catch (error) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, "Commit/Reveal failed"),
      );
    } finally {
      setIsPerforming(false);
      window.close();
    }
  };

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

  const networkMismatched = networkId?.toString() !== payload.networkId;
  const switchNetwork = () => {
    setSettings((prev) => ({
      ...prev,
      networkId: payload.networkId as NetworkType,
    }));
  };

  return (
    <>
      {!walletSigner && <Splash />}
      {walletSigner && (
        <div className="flex h-full flex-col justify-between">
          <div>
            <Header showPrevious={false} showClose={false} title="Confirm" />
            <div className="relative">
              <img src={signImage} alt="Sign" className="mx-auto" />
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
                <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
                  <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex w-full items-start justify-between">
                      <span className="font-medium">
                        Change to your balance
                      </span>
                      <div
                        className={twMerge(
                          "flex flex-col text-right",
                          differenceInKas >= 0
                            ? "text-teal-500"
                            : "text-red-500",
                        )}
                      >
                        <span className="font-medium">
                          {differenceInKas >= 0 && "+"}
                          {differenceInKas.toFixed(3)} KAS
                        </span>
                        <span className="text-xs text-daintree-400">
                          {formatCurrency(
                            differenceCurrency,
                            differenceCurrencyCode,
                          )}
                        </span>
                      </div>
                    </div>
                  </li>
                </ul>

                {/* Result */}
                <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
                  <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex w-full items-start justify-between">
                      <span className="font-medium">Fee</span>
                      <div className="flex flex-col text-right">
                        <span className="font-medium">
                          {feesInKas.toFixed(3)} KAS
                        </span>
                        <span className="text-xs text-daintree-400">
                          {formatCurrency(feesCurrency, feesCurrencyCode)}
                        </span>
                      </div>
                    </div>
                  </li>

                  <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex w-full items-start justify-between">
                      <span className="font-medium">Namespace</span>
                      <div className="flex flex-col text-right">
                        <span className="font-medium">{payload.namespace}</span>
                      </div>
                    </div>
                  </li>
                </ul>

                <div className="space-y-4 py-4">
                  <span
                    className="inline-flex cursor-pointer items-center gap-2 font-semibold text-[#00B1D0]"
                    onClick={() => setHideDetails(!hideDetails)}
                  >
                    Show raw commit/reveal script details
                    {hideDetails ? (
                      <i className="hn hn-chevron-down h-[14px] w-[14px]" />
                    ) : (
                      <i className="hn hn-chevron-up h-[14px] w-[14px]" />
                    )}
                  </span>

                  {!hideDetails && <ScriptDetailsBox content={payload.data} />}
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
                className="rounded-full p-5 text-[#7B9AAA]"
                onClick={() => {
                  window.close();
                }}
              >
                Cancel
              </button>
              <button
                className="flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
                onClick={perform}
              >
                {isPerforming ? (
                  <div className="flex gap-2">
                    <div
                      className="inline-block size-5 animate-spin self-center rounded-full border-[3px] border-current border-t-[#A2F5FF] text-icy-blue-600"
                      role="status"
                      aria-label="loading"
                    />
                    <span className="capitalize">
                      {step && step.at(0)?.toUpperCase() + step.slice(1)}
                    </span>
                  </div>
                ) : (
                  "Confirm"
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
