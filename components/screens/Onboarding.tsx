import { FormProvider, useForm } from "react-hook-form";
import Welcome from "@/components/onboarding/Welcome.tsx";
import SetupPassword from "@/components/onboarding/SetupPassword.tsx";
import ChooseImport from "@/components/onboarding/ChooseImport.tsx";
import ImportRecoveryPhrase from "@/components/screens/full-pages/ImportRecoveryPhrase.tsx";

export type OnboardingData = {
  step:
    | "welcome"
    | "password"
    | "choose"
    | "recovery-phrase"
    | "private-key"
    | "ledger";
  method: "create" | "import";
  password: string;
  confirmPassword: string;
  agreedTnc: boolean;
};

export default function Onboarding() {
  const form = useForm<OnboardingData>({
    defaultValues: {
      step: "welcome",
    },
    mode: "onChange",
  });
  const step = form.watch("step");

  return (
    <FormProvider {...form}>
      {step === "welcome" && <Welcome />}
      {step === "password" && <SetupPassword />}
      {step === "choose" && <ChooseImport />}
      {step === "recovery-phrase" && <ImportRecoveryPhrase />}
    </FormProvider>
  );
}
