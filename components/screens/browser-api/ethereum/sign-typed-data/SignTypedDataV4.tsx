import useWalletManager from "@/hooks/useWalletManager";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import signImage from "@/assets/images/sign.png";
import Header from "@/components/GeneralHeader";
import { useBoolean } from "usehooks-ts";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { RPC_ERRORS } from "@/api/message";

type SignTypedDataV4Props = {
  requestId: string;
  walletSigner: IWallet;
  message: string;
};

export default function SignTypedDataV4({
  requestId,
  walletSigner,
  message,
}: SignTypedDataV4Props) {
  const { wallet } = useWalletManager();
  const { value: isSigning, toggle: toggleIsSigning } = useBoolean(false);

  const typedData = JSON.parse(message);
  const typedDataWithoutSchema = {
    domain: typedData.domain,
    message: typedData.message,
  };

  const onConfirm = async () => {
    if (isSigning) {
      return;
    }

    toggleIsSigning();
    try {
      // Sign the message
      const signed = await walletSigner.signMessage(message);
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, signed),
      );
      toggleIsSigning();
    } catch (err) {
      console.error(err);
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.INTERNAL_ERROR),
      );
    } finally {
      window.close();
    }
  };

  const cancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(
        requestId,
        null,
        RPC_ERRORS.USER_REJECTED_REQUEST,
      ),
    );
    window.close();
  };

  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div>
        <Header showPrevious={false} showClose={false} title="Confirm" />
        <div className="relative">
          {wallet?.type !== "ledger" && (
            <img src={signImage} alt="Sign" className="mx-auto" />
          )}
          {wallet?.type === "ledger" && (
            <img src={ledgerSignImage} alt="Sign" className="mx-auto" />
          )}
        </div>

        {/* Confirm Content */}
        <div className="text-center">
          <h2 className="mt-4 text-2xl font-semibold">Sign Typed Data</h2>
          <p className="mt-2 text-base text-daintree-400">
            Please confirm the typed data you are signing
          </p>
          <div className="mt-4 overflow-auto break-words rounded-md bg-daintree-700 p-4">
            <p className="whitespace-pre text-start text-sm">
              {JSON.stringify(typedDataWithoutSchema, null, 2)}
            </p>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button className="rounded-full p-5 text-[#7B9AAA]" onClick={cancel}>
          Cancel
        </button>
        <button
          className="flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
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
      </div>
    </div>
  );
}
