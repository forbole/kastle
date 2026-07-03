import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFormContext } from "react-hook-form";
import { v4 as uuid } from "uuid";
import { Mnemonic } from "@/wasm/core/kaspa";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import useKeyring from "@/hooks/useKeyring.ts";
import useAnalytics from "@/hooks/useAnalytics.ts";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";
import ImportRecoveryPhrasePage from "@/ui/full-page/import-recovery-phrase/ImportRecoveryPhrasePage";
import ImportPassphrasePage from "@/ui/full-page/import-passphrase/ImportPassphrasePage";

type Step = "phrase" | "passphrase";

export default function ImportRecoveryPhraseWithPassphrase() {
  const { emitWalletCreated } = useAnalytics();
  const navigate = useNavigate();
  const { keyringInitialize } = useKeyring();
  const { importWalletByMnemonic } = useWalletImporter();
  const onboardingForm = useFormContext<OnboardingData>();

  const keyringReady = useRef(false);

  const [step, setStep] = useState<Step>("phrase");
  const [mnemonic, setMnemonic] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [phraseError, setPhraseError] = useState<string>();
  const [passphraseError, setPassphraseError] = useState<string>();

  const handlePhraseSubmit = (words: string[]) => {
    const joined = words.join(" ");
    try {
      new Mnemonic(joined);
    } catch {
      setPhraseError("The recovery phrase is invalid. Please check it.");
      return;
    }
    setPhraseError(undefined);
    setMnemonic(joined);
    setStep("passphrase");
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    setIsLoading(true);
    setPassphraseError(undefined);
    try {
      if (onboardingForm && !keyringReady.current) {
        await keyringInitialize(onboardingForm.getValues("password"));
        keyringReady.current = true;
      }

      const walletId = uuid();
      const address = await importWalletByMnemonic(
        walletId,
        mnemonic,
        "Account 0",
        true,
        passphrase || undefined,
      );
      emitWalletCreated({ method: "import", sender: address ?? undefined });
      navigate(`/manage-accounts/recovery-phrase/${walletId}/import`, {
        state: {
          ...(onboardingForm && { redirect: "/onboarding-success/import" }),
        },
      });
    } catch {
      setPassphraseError("Failed to import wallet. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhraseBack = () => {
    if (onboardingForm) {
      onboardingForm.setValue("step", "choose");
    } else {
      window.close();
    }
  };

  if (step === "passphrase") {
    return (
      <ImportPassphrasePage
        isLoading={isLoading}
        error={passphraseError}
        onBack={() => setStep("phrase")}
        onSubmit={handlePassphraseSubmit}
      />
    );
  }

  return (
    <ImportRecoveryPhrasePage
      title="Recovery phrase with passphrase"
      subtitle="Please fill in the recovery phrase"
      buttonLabel="Next"
      hasPassphrase
      error={phraseError}
      onBack={handlePhraseBack}
      onSubmit={handlePhraseSubmit}
    />
  );
}
