import { useParams } from "react-router-dom";
import React, { useState } from "react";
import { twMerge } from "tailwind-merge";
import { useCopyToClipboard } from "usehooks-ts";
import Header from "@/components/GeneralHeader";
import { Tooltip } from "react-tooltip";

export default function ShowRecoveryPhrase() {
  const { walletId } = useParams();
  const { disableWarning } = useBackupWarning();
  const { getWalletSecret } = useKeyring();
  const [hasAgreed, setHasAgreed] = useState(false);
  const [, copy] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const [isHidden, setIsHidden] = useState(true);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[]>();

  const copyPhrase = async () => {
    await copy(recoveryPhrase?.join(" ") ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  const handleHasBackedUp = async () => {
    if (walletId) {
      await disableWarning(walletId);
    }
    window.close();
  };

  const getMnemonic = useCallback(async () => {
    if (!walletId) {
      throw new Error("Wallet ID is missing");
    }

    const { walletSecret } = await getWalletSecret({ walletId });

    if (walletSecret.type !== "mnemonic") {
      throw new Error("Mnemonic is missing");
    }

    setRecoveryPhrase(walletSecret.value.split(" "));
  }, []);

  useEffect(() => {
    getMnemonic();
  }, [getMnemonic]);

  return (
    <div className="flex h-[54rem] w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="flex h-full flex-col justify-stretch gap-6 p-4 pb-6 text-white">
        <Header title="Backup Recovery phrase" showPrevious={false} />

        <div className="flex flex-grow flex-col items-stretch gap-4">
          <div className="relative">
            <div className={twMerge("flex flex-col gap-4", isHidden && "blur")}>
              <div className="flex justify-between">
                <button
                  type="button"
                  className="disabled:opacity-50/30 inline-flex items-center gap-x-2 rounded-lg border border-transparent px-4 py-3 text-sm font-medium text-icy-blue-400 hover:bg-daintree-700 hover:text-blue-400 focus:bg-blue-100 focus:bg-blue-800/30 focus:text-blue-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => setIsHidden(true)}
                >
                  <i className="hn hn-eye text-[14px]" />
                  <span>Hide words</span>
                </button>
                <button
                  data-tooltip-id="copy"
                  data-tooltip-content="Copied"
                  onClick={copyPhrase}
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
                  <span>Copy all</span>
                </button>
              </div>

              {/* Word grid */}
              <div className="grid grid-cols-3 gap-4">
                {recoveryPhrase?.map((_, index) => (
                  <div key={index} className="relative">
                    <input
                      value={recoveryPhrase?.[index]}
                      disabled
                      className={twMerge(
                        "peer block w-full rounded-lg border border-daintree-700 bg-daintree-800 py-3 pe-0 text-base font-medium text-white focus:ring-0 disabled:pointer-events-none disabled:opacity-50",
                        index >= 9 ? "ps-6" : "ps-5",
                      )}
                    />
                    <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2 text-[#4B5563] peer-disabled:pointer-events-none peer-disabled:opacity-50">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-center">
                <input
                  onChange={(e) => setHasAgreed(e.target.checked)}
                  type="checkbox"
                  className="mt-0.5 shrink-0 rounded border-neutral-700 bg-neutral-800 text-blue-600 checked:border-icy-blue-400 checked:bg-icy-blue-400 focus:ring-blue-500 focus:ring-offset-gray-800 disabled:pointer-events-none disabled:opacity-50"
                  id="agreed-reset"
                />
                <label
                  htmlFor="agreed-reset"
                  className="ms-3 text-sm text-gray-200"
                >
                  I’ve written it down.
                </label>
              </div>
            </div>
            {isHidden && (
              <button
                type="button"
                onClick={() => setIsHidden(false)}
                className="absolute inset-0 flex flex-col items-center justify-center gap-4"
              >
                <i className="hn hn-eye-cross text-[46px]"></i>
                <span className="text-base text-[#C8C3C0]">
                  Make sure no one is looking your screen
                </span>
              </button>
            )}
          </div>

          <button
            disabled={!hasAgreed}
            onClick={handleHasBackedUp}
            type="button"
            className="mt-auto inline-flex items-center justify-center gap-x-2 rounded-full border border-transparent bg-icy-blue-400 py-5 text-base text-white hover:bg-icy-blue-600 disabled:bg-daintree-800 disabled:text-[#4B5563]"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
