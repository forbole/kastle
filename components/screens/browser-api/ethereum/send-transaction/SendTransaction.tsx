import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import useWalletManager from "@/hooks/useWalletManager";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import signImage from "@/assets/images/sign.png";
import Header from "@/components/GeneralHeader";
import { useBoolean } from "usehooks-ts";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { RPC_ERRORS } from "@/api/message";
import {
  TransactionSerializable,
  hexToBigInt,
  createPublicClient,
  http,
  hexToNumber,
} from "viem";
import { estimateFeesPerGas } from "viem/actions";
import { ethereumTransactionRequestSchema } from "@/api/background/handlers/ethereum/sendTransaction";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/api/background/handlers/ethereum/utils";

type SignTransactionProps = {
  walletSigner: IWallet;
};

export default function SendTransaction({
  walletSigner,
}: SignTransactionProps) {
  const [settings] = useSettings();
  const { wallet } = useWalletManager();
  const { value: isSigning, toggle: toggleIsSigning } = useBoolean(false);

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const onConfirm = async () => {
    if (isSigning || !settings) {
      return;
    }

    const result = ethereumTransactionRequestSchema.safeParse(payload);
    if (!result.success) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.INVALID_PARAMS),
      );
      window.close();
      return;
    }
    const parsedRequest = result.data;

    const supportedChains =
      settings.networkId === "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

    const txChainId = parsedRequest.chainId
      ? hexToNumber(parsedRequest.chainId)
      : settings.evmL2ChainId?.[settings.networkId];

    if (!txChainId) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.INVALID_PARAMS),
      );
      window.close();
      return;
    }

    const network = supportedChains.find((chain) => chain.id === txChainId);
    if (!network) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
          requestId,
          null,
          RPC_ERRORS.UNSUPPORTED_CHAIN,
        ),
      );
      window.close();
      return;
    }

    toggleIsSigning();
    try {
      const ethClient = createPublicClient({
        chain: network,
        transport: http(),
      });

      const nonce = await ethClient.getTransactionCount({
        address: (await walletSigner.getAddress()) as `0x${string}`,
      });

      const estimatedGas = await estimateFeesPerGas(ethClient);
      const gasLimit = await ethClient.estimateGas({
        account: parsedRequest.from,
        to: parsedRequest.to,
        value: parsedRequest.value && hexToBigInt(parsedRequest.value),
        data: parsedRequest.data,
      });

      // Build eip1559 transaction
      const transaction: TransactionSerializable = {
        to: parsedRequest.to,
        value: parsedRequest.value && hexToBigInt(parsedRequest.value),
        data: parsedRequest.data,

        gas: gasLimit,
        maxFeePerGas: parsedRequest.maxFeePerGas
          ? hexToBigInt(parsedRequest.maxFeePerGas)
          : estimatedGas.maxFeePerGas,
        maxPriorityFeePerGas: parsedRequest.maxPriorityFeePerGas
          ? hexToBigInt(parsedRequest.maxPriorityFeePerGas)
          : estimatedGas.maxPriorityFeePerGas,
        chainId: txChainId,
        type: "eip1559",
        nonce,
      };

      // Sign the message
      const signed = await walletSigner.signTransaction(transaction);

      const txHash = await ethClient.sendRawTransaction({
        serializedTransaction: signed as `0x${string}`,
      });
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, txHash),
      );
      toggleIsSigning();
    } catch (err) {
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
    <div className="flex h-full flex-col justify-between">
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
          <h2 className="mt-4 text-2xl font-semibold">Send Transaction</h2>
          <p className="mt-2 text-base text-daintree-400">
            Please confirm the transaction you are signing
          </p>
          <div className="mt-4 rounded-md bg-daintree-700 p-4">
            <p className="overflow-auto whitespace-pre text-start text-sm">
              {JSON.stringify(payload, null, 2)}
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
