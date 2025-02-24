import { LoadingStatus } from "@/components/send/LoadingStatus";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { kaspaToSompi } from "@/wasm/core/kaspa";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import { useEffect } from "react";
import useAnalytics from "@/hooks/useAnalytics.ts";
import { captureException } from "@sentry/react";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";

type HotWalletSendingProps = {
  accountFactory: AccountFactory;
  secret: WalletSecret;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
};

export default function HotWalletSending({
  accountFactory,
  secret,
  setOutTxs,
  onFail,
  onSuccess,
}: HotWalletSendingProps) {
  const { emitFirstTransaction } = useAnalytics();
  const { addRecentAddress } = useRecentAddresses();
  const { walletSettings } = useWalletManager();
  const calledOnce = useRef(false);
  const form = useFormContext<SendFormData>();
  const { amount, address } = form.watch();

  const sendTransaction = async () => {
    if (form.formState.isSubmitting || !amount || !address) {
      return;
    }

    try {
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const account =
        secret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(secret.value, accountIndex)
          : accountFactory.createFromPrivateKey(secret.value);

      const transactionResponse = {
        txIds: await account.send(kaspaToSompi(amount) ?? BigInt(0), address),
      };

      if (typeof transactionResponse === "string") {
        onFail();
        return;
      }

      await addRecentAddress({
        usedAt: new Date().getTime(),
        kaspaAddress: address,
      });

      setOutTxs(transactionResponse.txIds);
      // Don't await, analytics should not crash the app
      emitFirstTransaction({
        amount,
        coin: "KAS",
        direction: "send",
      });

      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (calledOnce.current) return;
    sendTransaction();
    calledOnce.current = true;
  }, []);

  return <LoadingStatus />;
}
