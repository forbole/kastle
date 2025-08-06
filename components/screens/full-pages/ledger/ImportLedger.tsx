import { AccountFactory } from "@/lib/wallet/account-factory";
import { useNavigate } from "react-router-dom";
import useLedgerTransport from "@/hooks/useLedgerTransport";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { v4 as uuid } from "uuid";
import { captureException } from "@sentry/react";
import Header from "@/components/GeneralHeader";
import successImage from "@/assets/images/success.png";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import { useFormContext } from "react-hook-form";
import LedgerConnectForImport from "@/components/screens/full-pages/ledger/LedgerConnectForImport";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";

export default function ImportLedger() {
  const { transport, isAppOpen } = useLedgerTransport();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { importWalletByLedger } = useWalletImporter();
  const onboardingForm = useFormContext<OnboardingData>();

  const importLedgerAccount = async () => {
    if (!transport || !rpcClient || !networkId) {
      return;
    }

    try {
      if (onboardingForm) {
        await keyringInitialize(onboardingForm.getValues("password"));
      }

      const accountFactory = new AccountFactory(rpcClient, networkId);
      const account = accountFactory.createFromLedger(transport);

      const publicKeys = await account.getPublicKeys();

      const walletId = uuid();

      await importWalletByLedger(
        walletId,
        publicKeys[0], // deviceId is the first publicKey
        publicKeys,
      );

      navigate(`/manage-accounts/ledger/${walletId}/import`, {
        state: {
          ...(onboardingForm && { redirect: "/onboarding-success/import" }),
        },
      });
    } catch (error) {
      captureException(error);
      console.error(error);

      navigate("/ledger-connect-for-import-failed");
    }
  };

  const onBack = () => onboardingForm.setValue("step", "choose");

  return (
    <>
      {(!transport || !isAppOpen) && <LedgerConnectForImport onBack={onBack} />}

      {transport && isAppOpen && (
        <div className="flex h-[35rem] w-[41rem] flex-col items-stretch justify-between gap-4 rounded-3xl bg-icy-blue-950 px-10 py-4 pb-6">
          <div className="space-y-16">
            <Header
              title="Ledger connected"
              showClose={false}
              showPrevious={!!onboardingForm}
              onBack={onBack}
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
      )}
    </>
  );
}
