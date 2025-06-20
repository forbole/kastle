import { useNavigate } from "react-router-dom";
import successImage from "@/assets/images/success.png";
import Header from "@/components/GeneralHeader";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { hexToNumber } from "viem";

interface SuccessProps {
  chainId: `0x${string}`;
  transactionIds?: string[] | undefined;
}

export default function SuccessStatus({
  chainId,
  transactionIds,
}: SuccessProps) {
  const navigate = useNavigate();
  const selectChain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (chain) => chain.id === hexToNumber(chainId),
  );

  const explorerLink = selectChain?.blockExplorers?.default?.url ?? "";
  const explorerTxLink = `${explorerLink}/tx/`;

  const onClose = () => {
    navigate("/dashboard");
  };

  const title = "KAS Dispatched!";
  const description = "Your KAS has been sent to the recipient's address";

  const openTransactions = () => {
    for (const transactionId of transactionIds ?? []) {
      browser.tabs.create({
        url: `${explorerTxLink}${transactionId}`,
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Header title={title} showPrevious={false} showClose={false} />
      <div className="mt-20 flex flex-1 flex-col justify-between">
        <div className="flex flex-col items-center gap-4">
          <img src={successImage} alt="Success" className="mx-auto h-24 w-24" />
          <div className="flex flex-col gap-2 text-center">
            <span className="text-xl font-semibold text-[#14B8A6]">
              Success
            </span>
            <span className="px-10 text-sm text-gray-400">{description}</span>
          </div>
          {transactionIds?.length !== 0 && (
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={openTransactions}
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View in explorer
              </span>
              {(transactionIds?.length ?? 0) > 1 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 p-3 text-xs font-medium text-white">
                  {transactionIds?.length}
                </span>
              )}
              <i className="hn hn-external-link text-icy-blue-400"></i>
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          className="flex justify-center rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
