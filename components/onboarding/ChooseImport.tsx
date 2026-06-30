import { useFormContext } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import useKeyring from "@/hooks/useKeyring.ts";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";
import useAnalytics from "@/hooks/useAnalytics";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import ImportWalletPage from "@/ui/full-page/import-wallet/ImportWalletPage";

export default function ChooseImport() {
  const form = useFormContext<OnboardingData>();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { createNewWallet } = useWalletImporter();
  const { emitWalletCreated } = useAnalytics();
  const password = form.watch("password");

  return (
    <ImportWalletPage
      onBack={() => form.setValue("step", "password")}
      methods={[
        {
          label: "Recovery phrase",
          description: "Use a 12- or 24-word recovery phrase.",
          onClick: () => form.setValue("step", "recovery-phrase"),
        },
        {
          label: "Private Key",
          description: "Use a private key.",
          onClick: () => form.setValue("step", "private-key"),
        },
        {
          label: "Ledger",
          description: "Connect a Ledger device via USB.",
          onClick: () => form.setValue("step", "ledger"),
        },
      ]}
      advancedMethods={[
        {
          label: "Recovery phrase with passphrase",
          description:
            "Use this if you protected your wallet with an extra passphrase during setup.",
          onClick: () => form.setValue("step", "recovery-phrase-with-passphrase"),
        },
      ]}
      onCreateWallet={async () => {
        await keyringInitialize(password);
        const address = await createNewWallet(uuid());
        emitWalletCreated({ method: "new", sender: address ?? undefined });
        navigate("/onboarding-success/create");
      }}
    />
  );
}
