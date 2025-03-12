import { SignTxPayload } from "@/api/message";
import SignTx from "@/components/screens/browser-api/sign-tx/SignTx";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";

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
  const { rpcClient, networkId: rpcNetworkId } = useRpcClientStateful();
  const [wallet, setWallet] = useState<IWallet>();
  const loading =
    !rpcClient || !wallet || !walletInfo || !account || !rpcNetworkId;

  useEffect(() => {
    if (!rpcClient || !walletInfo || !rpcNetworkId || !account) return;
    if (walletInfo.type !== "mnemonic" && walletInfo.type !== "privateKey") {
      throw new Error("Unsupported wallet type");
    }

    getWalletSecret({ walletId: walletInfo.id }).then(({ walletSecret }) => {
      const factory = new AccountFactory(rpcClient, rpcNetworkId);

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
      {loading && <Splash />}
      {!loading && (
        <SignTx
          walletType={walletInfo.type}
          wallet={wallet}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
