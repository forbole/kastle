import { useParams, useNavigate } from "react-router-dom";
import { Hex, Address } from "viem";
import { FormProvider, useForm } from "react-hook-form";
import Erc721TransferDetails from "@/components/erc721-transfer/Erc721TransferDetails.tsx";

const steps = ["details", "confirm", "broadcast", "success", "fail"] as const;
type Step = (typeof steps)[number];

export interface Erc721TransferFormData {
  userInput: string | undefined;
  address: Hex | undefined;
}

export default function Erc721Transfer() {
  const { chainId, contractAddress, tokenId } = useParams<{
    chainId: Hex;
    contractAddress: Address;
    tokenId: string;
  }>();

  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("details");

  const onBack = () => {
    setStep((prevState) => {
      if (steps.indexOf(prevState) === 0) {
        navigate(`/erc721/${chainId}/${contractAddress}/${tokenId}`);
      }

      const stepIdx = steps.indexOf(prevState);
      return steps[stepIdx - 1];
    });
  };

  const form = useForm<Erc721TransferFormData>({
    defaultValues: {},
    mode: "onChange",
  });

  return (
    <div className="flex h-full flex-col p-4 text-white">
      <FormProvider {...form}>
        {step === "details" && (
          <Erc721TransferDetails
            onNext={() => setStep("confirm")}
            onBack={onBack}
          />
        )}
      </FormProvider>
    </div>
  );
}
