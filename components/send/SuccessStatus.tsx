import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import React from "react";
import { useNavigate } from "react-router-dom";
import successImage from "@/assets/images/success.png";
import Header from "@/components/GeneralHeader";
import { useFormContext } from "react-hook-form";
import { TokenOperationFormData } from "@/components/send/krc20-send/Krc20Transfer";
import { KasSendForm } from "@/components/send/kas-send/KasSend";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";

interface SuccessProps {
  transactionIds?: string[] | undefined;
}

export const SuccessStatus = ({ transactionIds }: SuccessProps) => {
  const navigate = useNavigate();
  const { watch } = useFormContext<KasSendForm | TokenOperationFormData>();
  const { networkId } = useRpcClientStateful();
  const formFields = watch();

  const explorerTxLink = explorerTxLinks[networkId ?? NetworkType.Mainnet];

  const onClose = () => {
    navigate("/dashboard");
  };

  const isKrc20Operation = "opData" in formFields;
  const ticker = isKrc20Operation ? formFields.opData.tick : "KAS";
  const { data: tokenInfoResponse } = useTokenInfo(
    ticker === "KAS" ? undefined : ticker,
  );
  const tokenName = isKrc20Operation
    ? (tokenInfoResponse?.result?.[0]?.name ?? ticker)
    : "KAS";

  const op = isKrc20Operation ? formFields?.opData?.op : "";
  const opTitle: Record<string, string> = {
    transfer: `${tokenName.toUpperCase()} Dispatched`,
    deploy: `${tokenName.toUpperCase()} Deployed`,
    mint: `${tokenName.toUpperCase()} Minted`,
  };
  const opDescription: Record<string, string> = {
    transfer: `Your ${tokenName.toUpperCase()} has been sent to the recipient's address`,
    deploy: "A new token has been forged",
    mint: `${tokenName.toUpperCase()} has been forged!`,
  };

  const title = isKrc20Operation ? opTitle[op] : "KAS Dispatched!";
  const description = isKrc20Operation
    ? opDescription[op]
    : "Your KAS has been sent to the recipient's address";

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
          {isKrc20Operation && (
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => navigate(`/token-asset/${ticker}`)}
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View transaction history
              </span>
              <i className="hn hn-angle-right text-icy-blue-400"></i>
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
};
