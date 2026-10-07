import { useNavigate, useParams } from "react-router-dom";
import { FormProvider, useForm } from "react-hook-form";
import type { Registrar, TransferPlanned } from "@dotk/sdk-tx";
import DotkTransferDetails from "@/components/dotk-transfer/DotkTransferDetails.tsx";
import DotkTransferConfirm from "@/components/dotk-transfer/DotkTransferConfirm.tsx";
import DotkTransferBroadcast from "@/components/dotk-transfer/DotkTransferBroadcast.tsx";
import DotkTransferFailure from "@/components/dotk-transfer/DotkTransferFailure.tsx";
import KNSTransferSuccess from "@/components/kns-transfer/KNSTransferSuccess.tsx";
import useAnalytics from "@/hooks/useAnalytics";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;

type Step = (typeof steps)[number];

export interface DotkTransferFormData {
  name: string;
  userInput: string | undefined;
  address: string | undefined;
  domain: string | undefined;
}

export interface DotkTransferPlan {
  registrar: Registrar;
  plan: TransferPlanned;
}

export default function DotkTransfer() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");
  const { emitSendCompleted } = useAnalytics();
  const { account, wallet } = useWalletManager();
  const { isDotkEnabled } = useFeatureFlags();
  const [planned, setPlanned] = useState<DotkTransferPlan>();
  const [outTxs, setOutTxs] = useState<string[]>();
  const [failure, setFailure] = useState<string>();

  const form = useForm<DotkTransferFormData>({
    defaultValues: { name },
    mode: "onChange",
  });

  const onBack = () => {
    if (step === "details") {
      navigate(`/dotk/${name}`);
      return;
    }
    setStep(steps[steps.indexOf(step) - 1]);
  };

  // Covenant txs are version 1, which the Ledger signer refuses outright.
  if (!isDotkEnabled || wallet?.type === "ledger") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center text-white">
        <span className="text-sm text-daintree-400">
          {isDotkEnabled
            ? "Ledger doesn’t support .k transfers: covenant transactions (version 1) can’t be signed on the device."
            : "Transferring .k names is unavailable right now."}
        </span>
        <button
          onClick={() => navigate(`/dotk/${name}`)}
          className="w-full rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white"
        >
          Back
        </button>
      </div>
    );
  }

  const emit = (status: "success" | "failed") =>
    emitSendCompleted({
      type: "DOTK",
      id: name,
      status,
      sender: account?.address,
    });

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <DotkTransferDetails
            planned={planned}
            setPlanned={setPlanned}
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
        {step === "confirm" && planned && (
          <DotkTransferConfirm
            plan={planned.plan}
            onNext={() => setStep("broadcast")}
            onBack={onBack}
          />
        )}
        {step === "broadcast" && planned && (
          <DotkTransferBroadcast
            planned={planned}
            setOutTxs={setOutTxs}
            onFail={(message) => {
              emit("failed");
              setFailure(message);
              setStep("fail");
            }}
            onSuccess={() => {
              emit("success");
              setStep("success");
            }}
          />
        )}
        {step === "success" && <KNSTransferSuccess transactionIds={outTxs} />}
        {step === "fail" && (
          <DotkTransferFailure transactionIds={outTxs} message={failure} />
        )}
      </FormProvider>
    </div>
  );
}
