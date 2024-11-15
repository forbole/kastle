import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { useNavigate } from "react-router-dom";
import toast from "@/components/Toast";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { v4 as uuid } from "uuid";

export default function ImportLedger() {
  const { transport } = useLedgerTransport();
  const navigate = useNavigate();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { importWalletByLedger } = useWalletManager();

  const importLedgerAccount = async () => {
    if (!transport || !rpcClient || !networkId) {
      return;
    }

    try {
      const accountFactory = new AccountFactory(rpcClient, networkId);
      const account = accountFactory.createFromLedger(transport);
      const publicKeys = await account.getPublicKeys();

      const walletId = uuid();

      await importWalletByLedger(
        walletId,
        publicKeys[0], // deviceId is the first publicKey
        publicKeys,
      );

      navigate(`/manage-accounts/ledger/${walletId}/import`);
    } catch (error) {
      toast.error(
        "Failed to import account from Ledger device, please unlock and open Kaspa app and try again",
      );
      console.error(error);
    }
  };

  useEffect(() => {
    if (!transport) {
      const currentUrl = window.location.hash.replace("#", "");
      navigate("/connect-ledger?redirect=" + currentUrl);
    }
  }, [transport]);

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <button
        onClick={importLedgerAccount}
        className="flex items-center gap-2 rounded-full bg-icy-blue-400 p-5"
      >
        Import
      </button>
    </div>
  );
}
