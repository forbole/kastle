import { useFormContext } from "react-hook-form";
import { AccountsFormValues } from "@/components/screens/full-pages/account-management/ManageAccounts";
import React, { useState } from "react";
import { formatToken, formatUSD, walletAddressEllipsis } from "@/lib/utils.ts";
import { PublicKey } from "@/wasm/core/kaspa";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Tooltip } from "react-tooltip";
import { useCopyToClipboard } from "usehooks-ts";

type AccountItemProps = {
  accountIndex: number;
  publicKeys: string[];
};

export function AccountItem({ accountIndex, publicKeys }: AccountItemProps) {
  const { getBalancesByAddresses } = useWalletManager();
  const [addresses, setAddresses] = useState<string[]>([]);
  const { rpcClient, networkId } = useRpcClientStateful();
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  const [, copy] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const { register, getValues } = useFormContext<AccountsFormValues>();
  const [accountBalance, setAccountBalance] = useState<number>();
  const kaspaPrice = useKaspaPrice();

  const address = addresses[0];

  // Set addresses after rpcClient is set
  useEffect(() => {
    if (!rpcClient || !networkId) {
      return;
    }

    setAddresses(
      publicKeys.map((publicKey) =>
        new PublicKey(publicKey).toAddress(networkId).toString(),
      ),
    );
  }, [rpcClient]);

  // Fetch account balance after addresses are set
  useEffect(() => {
    if (!addresses.length) {
      return;
    }

    const refreshAccountBalance = async () => {
      if (!rpcClient) {
        return;
      }

      setAccountBalance(await getBalancesByAddresses(addresses));
    };

    refreshAccountBalance();
  }, [addresses, rpcClient]);

  const shrinkAddress = address ? walletAddressEllipsis(address) : "";

  const handleCopy = async () => {
    if (!address) {
      return;
    }
    await copy(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 500);
  };

  return (
    <div className="flex rounded-xl border border-daintree-700 bg-white/5">
      <div className="flex flex-grow gap-2 border-e border-daintree-700 p-3">
        <span className="inline-flex size-[38px] flex-none items-center justify-center self-center rounded-lg bg-white/5 font-semibold leading-none">
          {accountIndex}
        </span>
        <div className="flex flex-grow items-center justify-between gap-10 text-base">
          <Tooltip
            id={`clipboard-${accountIndex}`}
            style={{
              backgroundColor: "#6b7280",
              fontSize: "12px",
              fontWeight: 600,
              padding: "8px",
              zIndex: 9999,
            }}
            isOpen={copied}
          />
          <Tooltip
            id={`showWholeAddress-${accountIndex}`}
            style={{
              backgroundColor: "#6b7280",
              fontSize: "12px",
              fontWeight: 600,
              padding: "8px",
            }}
            isOpen={isHovered && !copied}
          />
          <span
            className="cursor-pointer break-all"
            onClick={handleCopy}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <span
              data-tooltip-id={`clipboard-${accountIndex}`}
              data-tooltip-content="Copied"
            >
              <a
                data-tooltip-id={`showWholeAddress-${accountIndex}`}
                data-tooltip-content={address}
              >
                {shrinkAddress}
              </a>
            </span>
          </span>
          <div>
            {accountBalance !== undefined ? (
              <div className="flex flex-grow flex-col items-end">
                <span>{formatToken(accountBalance)}</span>
                <span>{formatUSD(accountBalance * kaspaPrice.kaspaPrice)}</span>
              </div>
            ) : (
              <div className="h-[40px] w-[100px] animate-pulse self-center rounded-xl bg-daintree-700" />
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-3">
        <div className="items-center">
          <Tooltip
            id="addedFeedback"
            style={{
              backgroundColor: "#203c49",
              fontSize: "12px",
              fontWeight: 600,
              padding: "8px",
            }}
            isOpen={showAddFeedback}
          />
          <input
            {...register(`${accountIndex}.active`)}
            onClick={() => {
              if (getValues(`${accountIndex}.active`)) {
                return;
              }
              if (!showAddFeedback) {
                setShowAddFeedback(true);
                setTimeout(() => setShowAddFeedback(false), 500);
              }
            }}
            type="checkbox"
            className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-daintree-700 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-white before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-white focus:ring-transparent focus:ring-offset-transparent focus:checked:border-transparent disabled:pointer-events-none disabled:opacity-50"
            data-tooltip-id="addedFeedback"
            data-tooltip-content="Add to Kastle!"
          />
        </div>
      </div>
    </div>
  );
}
