import { SignTxPayload } from "@/api/message";
import SignTx from "@/components/screens/browser-api/sign-tx/SignTx";
import { IWallet } from "@/lib/wallet/interface";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

type HotWalletSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function HotWalletSignTx({
  requestId,
  payload,
}: HotWalletSignAndBroadcastProps) {
  const { getWalletSecret } = useKeyring();
  const { wallet: walletInfo, account } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const [wallet, setWallet] = useState<IWallet>();
  const loading =
    !rpcClient || !wallet || !walletInfo || !account || !networkId;

  useEffect(() => {
    if (!rpcClient || !walletInfo || !networkId || !account) return;
    if (walletInfo.type !== "mnemonic" && walletInfo.type !== "privateKey") {
      throw new Error("Unsupported wallet type");
    }

    getWalletSecret({ walletId: walletInfo.id }).then(({ walletSecret }) => {
      const factory = new AccountFactory(rpcClient, networkId);

      switch (walletInfo.type) {
        case "mnemonic":
          setWallet(
            factory.createFromMnemonic(walletSecret.value, account.index),
          );
          break;
        case "privateKey":
          setWallet(factory.createFromPrivateKey(walletSecret.value));
          break;
      }
    });
  }, [rpcClient, walletInfo, account]);

  return (
    <>
      {loading && <div>Loading...</div>}
      {!loading && (
        <SignTx
          wallet={wallet}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
