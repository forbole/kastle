import { useEffect, useRef, useState } from "react";
import { IWalletWithGetAddress } from "@/lib/ethereum/wallet/wallet-interface";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import ledgerSignImage from "@/assets/images/ledger-on-sign.svg";
import signImage from "@/assets/images/sign.png";
import Header from "@/components/GeneralHeader";
import { useBoolean } from "usehooks-ts";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { RPC_ERRORS } from "@/api/message";
import {
  hexToBigInt,
  createPublicClient,
  http,
  hexToNumber,
  numberToHex,
  formatEther,
  type PublicClient,
} from "viem";
import { ethereumTransactionRequestSchema } from "@/api/background/handlers/ethereum/sendTransaction";
import {
  getChainName,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
type SignTransactionProps = {
  walletSigner: IWalletWithGetAddress;
  balanceWaitMs?: number;
};
import { handleViemError, nodeFundsReason } from "@/lib/errors";
import {
  getEvmFeesPerGas,
  sendEvmTransaction,
} from "@/lib/ethereum/transaction";
import { useSettings } from "@/hooks/useSettings";
import useAnalytics from "@/hooks/useAnalytics";

type Funds =
  | { balance: bigint; need?: bigint; reason?: string }
  | { unknown: true };

const isShortOf = (funds?: Funds) =>
  !!funds &&
  "balance" in funds &&
  (!!funds.reason || (funds.need ?? 0n) > funds.balance);

// How long Confirm waits for a balance check still in flight before signing
// anyway. A healthy node answers in well under a second; around 3 s is where a
// wait stops reading as "the button is working" and people re-click or leave.
// Past it, a slow node must not hold the user's send hostage.
export const BALANCE_CHECK_WAIT_MS = 3_000;

export default function SendTransaction({
  walletSigner,
  balanceWaitMs = BALANCE_CHECK_WAIT_MS,
}: SignTransactionProps) {
  const [settings] = useSettings();
  const { wallet } = useWalletManager();
  const { emitEthSendTransaction } = useAnalytics();
  const { value: isSigning, toggle: toggleIsSigning } = useBoolean(false);

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const origin =
    new URLSearchParams(window.location.search).get("origin") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "payload",
  );

  const payload = encodedPayload
    ? JSON.parse(decodeURIComponent(encodedPayload))
    : null;

  const parsedRequest = ethereumTransactionRequestSchema.parse(payload);

  const txChainId = parsedRequest.chainId
    ? hexToNumber(parsedRequest.chainId)
    : settings?.evmL2ChainId?.[settings.networkId];

  const supportedChains =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;
  const network = txChainId
    ? supportedChains.find((chain) => chain.id === txChainId)
    : undefined;
  const valueInWei = parsedRequest.value
    ? hexToBigInt(parsedRequest.value)
    : undefined;

  // The gas the signer uses: the page's, else the node's estimate.
  const getGas = (ethClient: PublicClient) =>
    parsedRequest.gas
      ? Promise.resolve(hexToBigInt(parsedRequest.gas))
      : ethClient.estimateGas({
          account: parsedRequest.from as `0x${string}`,
          to: parsedRequest.to as `0x${string}`,
          value: valueInWei,
          data: parsedRequest.data as `0x${string}` | undefined,
        });

  // Before the signature: can the balance pay gas x maxFeePerGas + value, read
  // from the same gas and fee sources the signer uses? An unreadable balance
  // is reported, not refused.
  const [funds, setFunds] = useState<Funds>();
  // The check in flight, so a Confirm clicked before it answers can wait on it.
  const fundsCheck = useRef<Promise<Funds>>();
  useEffect(() => {
    if (!settings || !network) return;
    let live = true;
    const ethClient = createPublicClient({ chain: network, transport: http() });
    const check = Promise.allSettled([
      ethClient.getBalance({ address: parsedRequest.from as `0x${string}` }),
      getGas(ethClient),
      getEvmFeesPerGas(ethClient),
    ])
      .then(([balance, gas, fees]): Funds => {
        if (balance.status === "rejected") return { unknown: true };
        if (gas.status === "rejected") {
          const reason = nodeFundsReason(gas.reason);
          return reason
            ? { balance: balance.value, reason }
            : { unknown: true };
        }
        if (fees.status === "rejected") return { unknown: true };
        const need = gas.value * fees.value.maxFeePerGas + (valueInWei ?? 0n);
        return { balance: balance.value, need };
      })
      .catch((): Funds => ({ unknown: true }));
    fundsCheck.current = check;
    check.then((result) => live && setFunds(result));
    return () => {
      live = false;
    };
  }, [settings?.networkId, network?.id]);

  const symbol = network?.nativeCurrency.symbol ?? "KAS";
  const isShort = isShortOf(funds);

  const onConfirm = async () => {
    if (isSigning || !settings || isShort) {
      return;
    }

    if (!txChainId) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.INVALID_PARAMS),
      );
      window.close();
      return;
    }

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

    // Clicked before the balance check answered: wait for it, bounded. No
    // answer in time signs anyway, under the "couldn't check" line.
    let checked = funds;
    if (!checked) {
      checked =
        (await Promise.race([
          fundsCheck.current,
          new Promise<undefined>((r) => setTimeout(r, balanceWaitMs)),
        ])) ?? ({ unknown: true } as const);
      setFunds(checked);
    }
    if (isShortOf(checked)) {
      toggleIsSigning();
      return;
    }

    try {
      const ethClient = createPublicClient({
        chain: network,
        transport: http(),
      });

      const gas = await getGas(ethClient);

      const txHash = await sendEvmTransaction({
        ethClient,
        signer: walletSigner,
        sender: parsedRequest.from as `0x${string}`,
        to: parsedRequest.to as `0x${string}`,
        valueInWei,
        gas,
        chainId: txChainId,
        data: parsedRequest.data as `0x${string}` | undefined,
      });

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, txHash),
      );
      emitEthSendTransaction({ origin, status: "success" });
      toggleIsSigning();
    } catch (err) {
      emitEthSendTransaction({ origin, status: "failed" });
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, handleViemError(err)),
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

  const targetChainName = txChainId
    ? getChainName(numberToHex(txChainId))
    : null;

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Header
          showPrevious={false}
          showClose={false}
          title="Send Transaction"
        />
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
        </div>

        {/* Confirm Content */}
        <div className="text-center">
          <h2 className="mt-4 text-2xl font-semibold">{targetChainName}</h2>
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

      {funds && "balance" in funds && isShort && (
        <div className="mt-4 text-center text-sm text-red-500">
          {funds.need !== undefined
            ? `Not enough ${symbol} to pay for this transaction: it needs ${formatEther(funds.need)} ${symbol} (gas + value), your balance is ${formatEther(funds.balance)} ${symbol}.`
            : `Not enough ${symbol} to pay for gas: your balance is ${formatEther(funds.balance)} ${symbol}. The network says: ${funds.reason}`}
        </div>
      )}
      {funds && "unknown" in funds && (
        <div className="mt-4 text-center text-sm text-daintree-400">
          {`Couldn't check that your ${symbol} balance covers this transaction's fee. You can still confirm.`}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button className="rounded-full p-5 text-[#7B9AAA]" onClick={cancel}>
          Cancel
        </button>
        <button
          className="flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600 disabled:cursor-not-allowed disabled:bg-icy-blue-800"
          onClick={onConfirm}
          disabled={(isSigning && !targetChainName) || isShort}
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
