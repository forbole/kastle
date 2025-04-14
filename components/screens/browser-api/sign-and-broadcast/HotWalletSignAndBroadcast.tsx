import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import SignAndBroadcast from "@/components/screens/browser-api/sign-and-broadcast/SignAndBroadcast";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";

type HotWalletSignAndBroadcastProps = {
  requestId: string;
  payload: SignTxPayload;
};

export default function HotWalletSignAndBroadcast({
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
      {loading && <Splash />}
      {!loading && (
        <SignAndBroadcast
          wallet={wallet}
          requestId={requestId}
          payload={payload}
        />
      )}
    </>
  );
}
