import { useFormContext } from "react-hook-form";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import WelcomePage from "@/ui/full-page/welcome/WelcomePage";

export default function Welcome() {
  const form = useFormContext<OnboardingData>();

  return (
    <WelcomePage
      onPrimaryClick={() => {
        form.setValue("method", "create");
        form.setValue("step", "password");
      }}
      onSecondaryClick={() => {
        form.setValue("method", "import");
        form.setValue("step", "password");
      }}
    />
  );
}
