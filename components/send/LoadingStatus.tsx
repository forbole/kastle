import React, { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";
import carriageImage from "@/assets/images/carriage.png";

interface LoadingStatusProps {
  sendTransaction: (data: {
    amount: string;
    receiverAddress: string;
  }) => Promise<string | { txIds: string[] }>;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export const LoadingStatus = ({
  sendTransaction,
  setOutTxs,
  onFail,
  onSuccess,
}: LoadingStatusProps) => {
  const calledOnce = useRef(false);
  const form = useFormContext<SendFormData>();

  const handleSubmit = form.handleSubmit(async ({ address, amount }) => {
    if (form.formState.isSubmitting || !amount || !address) {
      return;
    }

    try {
      const transactionResponse = await sendTransaction({
        amount,
        receiverAddress: address,
      });

      if (typeof transactionResponse === "string") {
        onFail();
        return;
      }

      setOutTxs(transactionResponse.txIds);

      onSuccess();
    } catch (e) {
      console.error(e);
      onFail();
    }
  });

  useEffect(() => {
    if (calledOnce.current) return;
    handleSubmit();
    calledOnce.current = true;
  }, []);

  return (
    <>
      <div className="flex items-center justify-center">
        <h1 className="text-center text-3xl font-semibold">Broadcasting</h1>
      </div>

      <div className="flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[299px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Broadcasting...
        </span>
      </div>
    </>
  );
};
