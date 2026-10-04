import { useEffect } from "react";
import { captureException } from "@sentry/react";
import { useFormContext } from "react-hook-form";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import type {
  DotkTransferFormData,
  DotkTransferPlan,
} from "@/components/dotk-transfer/DotkTransfer.tsx";

interface DotkTransferBroadcastProps {
  planned: DotkTransferPlan;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: (message?: string) => void;
  onSuccess: () => void;
}

export default function DotkTransferBroadcast({
  planned,
  setOutTxs,
  onFail,
  onSuccess,
}: DotkTransferBroadcastProps) {
  const calledOnce = useRef(false);
  const { addRecentAddress } = useRecentAddresses();
  const { watch } = useFormContext<DotkTransferFormData>();
  const { address, domain } = watch();

  const broadcastOperation = async () => {
    try {
      // The plan already carries the recipient; the form address is only for
      // the recent-addresses list.
      const txId = await planned.registrar.submit(planned.plan);
      setOutTxs([txId]);

      if (address) {
        await addRecentAddress({
          kaspaAddress: address,
          usedAt: new Date().getTime(),
          domain,
        });
      }
      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail(e instanceof Error ? e.message : undefined);
    }
  };

  // Once only: a second submit would re-sign and re-send the same covenant spend.
  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    broadcastOperation();
  }, []);

  return (
    <>
      <Header title="Transferring" showPrevious={false} showClose={false} />

      <div className="mt-10 flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="aspect-[686/240] w-full max-w-[343px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Transferring...
        </span>
      </div>
    </>
  );
}
