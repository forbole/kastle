import { Broadcasting } from "@/components/send/Broadcasting";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { useFormContext } from "react-hook-form";
import { TokenOperationFormData } from "@/components/send/krc20-send/Krc20Transfer";
import { useEffect } from "react";
import { captureException } from "@sentry/react";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { transfer } from "@/lib/krc20.ts";

type HotWalletSendingProps = {
  accountFactory: AccountFactory;
  secret: WalletSecret;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
};

export default function HotWalletBroadcastTokenOperation({
  accountFactory,
  secret,
  setOutTxs,
  onFail,
  onSuccess,
}: HotWalletSendingProps) {
  const { addRecentAddress } = useRecentAddresses();
  const { watch } = useFormContext<TokenOperationFormData>();
  const calledOnce = useRef(false);
  const opData = watch("opData");
  const domain = watch("domain");
  const { walletSettings } = useWalletManager();

  const broadcastOperation = async () => {
    try {
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      const account =
        secret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(secret.value, accountIndex)
          : accountFactory.createFromPrivateKey(secret.value);

      for await (const result of transfer(account, {
        tick: opData.tick,
        amt: opData.amt,
        to: opData.to,
      })) {
        if (result.status === "completed") {
          setOutTxs([result.commitTxId!, result.revealTxId!]);
        }
      }

      const tokenOperationRecipientAddress = opData?.to;
      if (tokenOperationRecipientAddress) {
        await addRecentAddress({
          kaspaAddress: tokenOperationRecipientAddress,
          usedAt: new Date().getTime(),
          domain,
        });
      }

      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    broadcastOperation();
  }, []);

  return <Broadcasting onSuccess={onSuccess} />;
}
