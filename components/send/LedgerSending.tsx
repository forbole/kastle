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
import LedgerConfirm from "@/components/screens/ledger-connect/LedgerConfirm";

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
  const { transport, isAppOpen } = useLedgerTransport();
  const { walletSettings } = useWalletManager();
  const calledOnce = useRef(false);
  const form = useFormContext<SendFormData>();
  const { amount, address, domain } = form.watch();
  const [signing, setSigning] = useState(true);
  const state = {
    form: form.getValues(),
    step: "confirm",
  };

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

      setSigning(false);

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

      setTimeout(() => {
        onSuccess();
      }, 2000); // Delay to prevent the page from flickering
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (!transport || !isAppOpen) {
      navigate({
        pathname: "/ledger-connect-for-sign",
        search: `?redirect=/send&state=${encodeURIComponent(JSON.stringify(state))}`,
      });
      return;
    }

    if (calledOnce.current) return;
    sendTransaction();
    calledOnce.current = true;
  }, [transport]);

  return signing ? (
    <LedgerConfirm
      onBack={() => navigate("/send", { state })}
      onClose={() => navigate("/dashboard")}
    />
  ) : (
    <LoadingStatus />
  );
}
