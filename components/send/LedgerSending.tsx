import { LoadingStatus } from "@/components/send/LoadingStatus";
import { WalletSecret } from "@/types/WalletSecret";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { kaspaToSompi } from "@/wasm/core/kaspa";
import useLedgerTransport from "@/hooks/useLedgerTransport";

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
  const { transport, connect } = useLedgerTransport();
  const { walletSettings } = useWalletManager();

  const sendTransaction = async ({
    amount,
    receiverAddress,
  }: {
    amount: string;
    receiverAddress: string;
  }) => {
    if (!transport) {
      throw new Error("Ledger transport not available");
    }

    const accountIndex = walletSettings?.selectedAccountIndex;
    if (accountIndex === null || accountIndex === undefined) {
      throw new Error("No account selected");
    }

    const account = accountFactory.createFromLedger(transport, accountIndex);
    const publicKeys = await account.getPublicKeys();

    if (secret.value !== publicKeys[0]) {
      throw new Error("Invalid Ledger device");
    }

    return {
      txIds: await account.send(
        kaspaToSompi(amount) ?? BigInt(0),
        receiverAddress,
      ),
    };
  };

  return !transport ? (
    <>
      <div>Waiting for connecting</div>
      <button onClick={connect}>Connect</button>
    </>
  ) : (
    <LoadingStatus
      sendTransaction={sendTransaction}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onSuccess={onSuccess}
    />
  );
}
