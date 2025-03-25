import { FormProvider, useForm } from "react-hook-form";
import Welcome from "@/components/onboarding/Welcome.tsx";
import SetupPassword from "@/components/onboarding/SetupPassword.tsx";
import OnboardingSuccess from "@/components/onboarding/OnboardingSuccess.tsx";

export type OnboardingData = {
  step: "welcome" | "password" | "choose" | "accounts" | "success";
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
      {step === "success" && <OnboardingSuccess />}
    </FormProvider>
  );
}
