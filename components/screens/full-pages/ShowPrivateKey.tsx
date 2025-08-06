import { useParams } from "react-router-dom";
import React, { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useBoolean, useCopyToClipboard } from "usehooks-ts";
import Header from "@/components/GeneralHeader";
import { Tooltip } from "react-tooltip";
import useAccountManager from "@/hooks/wallet/useAccountManager";

export default function ShowPrivateKey() {
  const { walletId, accountIndex } = useParams();
  const accountIndexNumber = accountIndex
    ? parseInt(accountIndex, 10)
    : undefined;
  const [, copy] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const { getAccountPrivateKey } = useAccountManager();
  const { value: isHidden, toggle: toggleHidden } = useBoolean(true);
  const [privateKey, setPrivateKey] = useState<string>();

  const copyPrivateKey = async () => {
    await copy(privateKey ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  const onClose = () => window.close();

  const getPrivateKeyCallback = useCallback(async () => {
    if (!walletId || accountIndexNumber === undefined) {
      throw new Error("Wallet ID or account number is missing");
    }

    const privateKey = await getAccountPrivateKey({
      walletId,
      accountIndex: accountIndexNumber,
    });

    setPrivateKey(privateKey);
  }, []);

  useEffect(() => {
    getPrivateKeyCallback();
  }, [getPrivateKeyCallback]);

  return (
    <div className="flex h-[35rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950 p-4 pb-6">
      <Header title="Back up Private key" showPrevious={false} />

      <div className="flex flex-grow flex-col items-stretch gap-4">
        <div className="relative">
          <div className="flex flex-col gap-4">
            <div className="flex justify-between">
              <button
                type="button"
                className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                onClick={toggleHidden}
              >
                <i className="hn hn-eye text-[14px]" />
                {isHidden ? "Show private key" : "Hide private key"}
              </button>
              <button
                data-tooltip-id="copy"
                data-tooltip-content="Copied"
                onClick={copyPrivateKey}
                type="button"
                className="inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                <Tooltip
                  data-tooltip-id="copy"
                  data-tooltip-content="Copied"
                  id="copy"
                  offset={0}
                  style={{
                    backgroundColor: "#374151",
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "2px 8px",
                  }}
                  isOpen={copied}
                />
                <span>Copy</span>
              </button>
            </div>

            {/* Word grid */}
            <textarea
              placeholder="Private key"
              value={privateKey}
              className={twMerge(
                "peer block h-[120px] w-full resize-none rounded-lg border border-daintree-700 bg-daintree-800 p-3 text-base text-white placeholder-daintree-200 hover:placeholder-daintree-50 focus:ring-0 disabled:pointer-events-none disabled:opacity-50",
                isHidden && "text-security-disc",
              )}
            />
          </div>
        </div>

        <button
          onClick={onClose}
          type="button"
          className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 px-4 py-3 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
        >
          Close
        </button>
      </div>
    </div>
  );
}
