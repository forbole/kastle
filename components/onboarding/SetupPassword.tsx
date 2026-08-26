import { useRef } from "react";
import { useFormContext } from "react-hook-form";
import { useLocation } from "react-router";
import { useNavigate } from "react-router-dom";
import { v4 as uuid } from "uuid";
import useKeyring from "@/hooks/useKeyring.ts";
import useResetPreline from "@/hooks/useResetPreline.ts";
import useAnalytics from "@/hooks/useAnalytics.ts";
import useWalletImporter from "@/hooks/wallet/useWalletImporter";
import { OnboardingData } from "@/components/screens/Onboarding.tsx";
import CreatePasswordPage from "@/ui/full-page/create-password/CreatePasswordPage";
import internalToast from "@/components/Toast.tsx";

export default function SetupPassword() {
  const { keyringInitialize } = useKeyring();
  const { createNewWallet } = useWalletImporter();
  const { emitWalletCreated } = useAnalytics();
  const location = useLocation();
  const navigate = useNavigate();
  const form = useFormContext<OnboardingData>();
  const method = form.watch("method");
  const isCreating = useRef(false);

  useResetPreline([location.pathname]);

  const handleSubmit = async (password: string) => {
    form.setValue("password", password);

    if (method === "create") {
      if (isCreating.current) return;
      isCreating.current = true;
      try {
        await keyringInitialize(password);
        const address = await createNewWallet(uuid());
        emitWalletCreated({ method: "new", sender: address ?? undefined });
        navigate("/onboarding-success/create");
      } catch {
        internalToast.error("Failed to create wallet");
      } finally {
        isCreating.current = false;
      }
    } else {
      form.setValue("step", "choose");
    }
  };

  return (
    <CreatePasswordPage
      buttonLabel={method === "import" ? "Next" : "Create wallet"}
      onBack={() => form.setValue("step", "welcome")}
      onSubmit={handleSubmit}
    />
  );
}
