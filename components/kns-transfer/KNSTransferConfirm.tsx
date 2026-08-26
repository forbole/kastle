import { useFormContext } from "react-hook-form";
import { KNSTransferFormData } from "@/components/screens/KNSTransfer.tsx";
import { useAssetDetails } from "@/hooks/kns/useKns";
import Header from "@/components/GeneralHeader.tsx";
import signImage from "@/assets/images/sign.png";
import { useNavigate } from "react-router-dom";
import { buildKnsTransferScript } from "@/lib/kns.ts";
import { formatCurrency, formatToken } from "@/lib/utils.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { PublicKey } from "@/wasm/core/kaspa";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useKasFeeEstimate } from "@/hooks/useKasFeeEstimate";

type KNSTransferConfirmProps = {
  onNext?: () => void;
  onBack?: () => void;
};

export default function KNSTransferConfirm({
  onNext,
  onBack,
}: KNSTransferConfirmProps) {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const { watch } = useFormContext<KNSTransferFormData>();
  const { assetId, address, domain } = watch();
  const { data: response } = useAssetDetails(assetId);
  const kaspaPrice = useKaspaPrice();

  const scriptHex = useMemo(() => {
    const pubKeyHex = account?.publicKeys?.[0];
    if (!pubKeyHex || !assetId || !address) return undefined;
    try {
      return buildKnsTransferScript(new PublicKey(pubKeyHex), {
        id: assetId,
        to: address,
      }).toString();
    } catch {
      return undefined;
    }
  }, [account?.publicKeys?.[0], assetId, address]);

  const { fee: commitFee } = useKasFeeEstimate();
  const { fee: revealFee } = useKasFeeEstimate(
    scriptHex ? { scriptsHexes: [scriptHex] } : undefined,
  );
  const totalFee = ((commitFee ?? 0) + (revealFee ?? 0)) / 1e8;
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    totalFee * kaspaPrice.kaspaPrice,
  );

  const asset = response?.data;

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <Header title="Confirm" onClose={onClose} onBack={onBack} />

      <div className="flex h-full flex-col gap-2">
        <img
          alt="castle"
          className="aspect-[686/240] w-full max-w-[343px] self-center"
          src={signImage}
        />

        {/* Recipient */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">{asset?.asset}</span>
            <span>from</span>
          </div>
          <span className="break-all text-xs text-daintree-400">
            {asset?.owner}
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">
            To
            {!!domain && ` - ${domain}`}
          </span>
          <span className="break-all text-xs text-daintree-400">{address}</span>
        </div>
        <div className="flex justify-between gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">Fee</span>
          <div className="flex flex-col items-end break-all">
            <span className="text-base font-medium text-white">
              ~{formatToken(totalFee, 3)} KAS
            </span>
            <span className="text-xs text-daintree-400">
              {formatCurrency(feesCurrency, feesCurrencyCode)}
            </span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            onClick={onNext}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}
