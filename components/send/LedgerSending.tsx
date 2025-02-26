import { LoadingStatus } from "@/components/send/LoadingStatus";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { kaspaToSompi } from "@/wasm/core/kaspa";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import { useEffect } from "react";
import useAnalytics from "@/hooks/useAnalytics.ts";
import { captureException } from "@sentry/react";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { useNavigate } from "react-router-dom";

type LedgerSendingProps = {
  accountFactory: AccountFactory;
  secret: WalletSecret;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
};

export default function LedgerSending({
  accountFactory,
  secret,
  setOutTxs,
  onFail,
  onSuccess,
}: LedgerSendingProps) {
  const navigate = useNavigate();
  const { addRecentAddress } = useRecentAddresses();
  const { emitFirstTransaction } = useAnalytics();
  const { transport } = useLedgerTransport();
  const { walletSettings } = useWalletManager();
  const calledOnce = useRef(false);
  const form = useFormContext<SendFormData>();
  const { amount, address, domain } = form.watch();

  const sendTransaction = async () => {
    if (!transport) {
      throw new Error("Ledger transport not available");
    }

    if (form.formState.isSubmitting || !amount || !address) {
      return;
    }

    try {
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const account = accountFactory.createFromLedger(transport, accountIndex);
      const publicKeys = await account.getPublicKeys();

      if (secret.value !== publicKeys[0]) {
        throw new Error("Invalid Ledger device");
      }

      const transactionResponse = {
        txIds: await account.send(kaspaToSompi(amount) ?? BigInt(0), address),
      };

      if (typeof transactionResponse === "string") {
        onFail();
        return;
      }

      setOutTxs(transactionResponse.txIds);
      // Don't await, analytics should not crash the app
      emitFirstTransaction({
        amount,
        coin: "KAS",
        direction: "send",
      });

      await addRecentAddress({
        kaspaAddress: address,
        usedAt: new Date().getTime(),
        domain,
      });

      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (!transport) {
      const currentUrl = window.location.hash.replace("#", "");
      const base64EncodedForm = btoa(JSON.stringify(form.getValues()));
      const redirectUrl = encodeURIComponent(
        `${currentUrl}?step=confirm&form=${base64EncodedForm}`,
      );
      navigate("/ledger-connect-for-sign?redirect=" + redirectUrl);
      return;
    }

    if (calledOnce.current) return;
    sendTransaction();
    calledOnce.current = true;
  }, [transport]);

  return <LoadingStatus />;
}
