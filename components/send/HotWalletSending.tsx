import { LoadingStatus } from "@/components/send/LoadingStatus";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { kaspaToSompi } from "@/wasm/core/kaspa";

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
  const { walletSettings } = useWalletManager();

  const sendTransaction = async ({
    amount,
    receiverAddress,
  }: {
    amount: string;
    receiverAddress: string;
  }) => {
    const accountIndex = walletSettings?.selectedAccountIndex;
    if (accountIndex === null || accountIndex === undefined) {
      throw new Error("No account selected");
    }

    const account =
      secret.type === "mnemonic"
        ? accountFactory.createFromMnemonic(secret.value, accountIndex)
        : accountFactory.createFromPrivateKey(secret.value);

    return {
      txIds: await account.send(
        kaspaToSompi(amount) ?? BigInt(0),
        receiverAddress,
      ),
    };
  };

  return (
    <LoadingStatus
      sendTransaction={sendTransaction}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onSuccess={onSuccess}
    />
  );
}
