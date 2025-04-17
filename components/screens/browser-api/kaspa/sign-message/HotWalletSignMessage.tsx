import { SignMessagePayload } from "@/api/background/handlers/kaspa/signMessage";
import SignMessage from "@/components/screens/browser-api/kaspa/sign-message/SignMessage";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import { AccountFactory } from "@/lib/wallet/wallet-factory";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import Splash from "@/components/screens/Splash.tsx";

type HotWalletSignMessageProps = {
  requestId: string;
  payload: SignMessagePayload;
};

export default function HotWalletSignMessage({
  requestId,
  payload,
}: HotWalletSignMessageProps) {
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
        <SignMessage
          walletSigner={wallet}
          requestId={requestId}
          message={payload.message}
        />
      )}
    </>
  );
}
