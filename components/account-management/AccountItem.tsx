import { useFormContext } from "react-hook-form";
import { AccountsFormValues } from "@/components/account-management/ManageAccounts";
import React, { useState } from "react";
import { formatToken, formatUSD } from "@/lib/utils.ts";
import { PublicKey } from "@/wasm/core/kaspa";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

type AccountItemProps = {
  accountIndex: number;
  publicKeys: string[];
};

export function AccountItem({ accountIndex, publicKeys }: AccountItemProps) {
  const { getBalancesByAddresses } = useWalletManager();
  const [addresses, setAddresses] = useState<string[]>([]);
  const { rpcClient, networkId } = useRpcClientStateful();

  const { register } = useFormContext<AccountsFormValues>();
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

  return (
    <div className="flex rounded-xl border border-daintree-700 bg-white/5">
      <div className="flex flex-grow gap-2 border-e border-daintree-700 p-3">
        <span className="inline-flex size-[38px] flex-none items-center justify-center self-center rounded-lg bg-white/5 font-semibold leading-none">
          {accountIndex}
        </span>
        <div className="flex flex-grow items-center justify-between gap-10 text-base">
          <span className="w-[310px] flex-grow break-all">{address}</span>
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
      <div className="flex flex-none items-center justify-center p-3">
        <div className="flex items-center">
          <input
            {...register(`${accountIndex}.active`)}
            type="checkbox"
            className="relative h-6 w-11 cursor-pointer rounded-full border-neutral-700 border-transparent bg-neutral-800 p-px text-transparent transition-colors duration-200 ease-in-out before:inline-block before:size-5 before:translate-x-0 before:transform before:rounded-full before:bg-neutral-400 before:shadow before:ring-0 before:transition before:duration-200 before:ease-in-out checked:border-icy-blue-400 checked:bg-icy-blue-400 checked:bg-none checked:text-icy-blue-400 checked:before:translate-x-full checked:before:bg-blue-200 focus:ring-blue-600 focus:ring-offset-gray-600 focus:checked:border-blue-600 disabled:pointer-events-none disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
