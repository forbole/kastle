import { AccountFactory } from "@/lib/wallet/wallet-factory";
import { useNavigate } from "react-router-dom";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { v4 as uuid } from "uuid";
import { captureException } from "@sentry/react";
import Header from "@/components/GeneralHeader";
import successImage from "@/assets/images/success.png";

export default function ImportLedger() {
  const { transport, isConnecting, isAppOpen } = useLedgerTransport();
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
      captureException(error);
      console.error(error);

      navigate("/ledger-connect-for-import-failed");
    }
  };

  useEffect(() => {
    const currentUrl = window.location.hash.replace("#", "");
    if (!transport && !isConnecting) {
      navigate("/ledger-connect-for-import?redirect=" + currentUrl);
    }

    if (!isAppOpen) {
      navigate("/ledger-connect-for-import?redirect=" + currentUrl);
    }
  }, [transport, isConnecting]);

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch justify-between gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <div className="space-y-16">
        <Header
          title="Ledger connected"
          showClose={false}
          showPrevious={false}
        />

        <div className="text-center">
          <img src={successImage} alt="Success" className="mx-auto pb-4" />
          <h3 className="text-xl font-semibold text-teal-500">Success</h3>
          <p className="text-sm text-[#7b9aaa]">
            Ledger connected! Now, please import your accounts.
          </p>
        </div>
      </div>
      <button
        onClick={importLedgerAccount}
        className="mt-auto inline-flex w-full justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
      >
        Import accounts
      </button>
    </div>
  );
}
