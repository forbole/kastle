import { useFormContext } from "react-hook-form";
import { AccountsFormValues } from "@/components/screens/full-pages/account-management/ManageAccounts";
import React, { useState } from "react";
import { formatCurrency, formatToken, textEllipsis } from "@/lib/utils.ts";
import { PublicKey } from "@/wasm/core/kaspa";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Tooltip } from "react-tooltip";
import useCurrencyValue from "@/hooks/useCurrencyValue";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import kaspaIcon from "@/assets/images/network-logos/kaspa.svg";
import { useSettings } from "@/hooks/useSettings";
import EvmAddressItem from "./EvmAddressItem";
import { numberToHex } from "viem";

type AccountItemProps = {
  accountIndex: number;
  publicKeys: string[];
  evmPublicKey?: `0x${string}`;
};

export function AccountItem({
  accountIndex,
  publicKeys,
  evmPublicKey,
}: AccountItemProps) {
  const [settings] = useSettings();

  const { getBalancesByAddresses } = useWalletManager();
  const [addresses, setAddresses] = useState<string[]>([]);
  const { rpcClient, networkId } = useRpcClientStateful();
  const [showAddFeedback, setShowAddFeedback] = useState(false);

  const { register, getValues } = useFormContext<AccountsFormValues>();
  const [accountBalance, setAccountBalance] = useState<number>();
  const kaspaPrice = useKaspaPrice();

  const fiatBalance = (accountBalance ?? 0) * kaspaPrice.kaspaPrice;
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

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

  const shrinkAddress = address ? textEllipsis(address) : "";

  const supportedEvmL2Chains =
    settings?.networkId == "mainnet" ? [] : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  return (
    <div className="flex flex-col rounded-xl border border-daintree-700 bg-white/5">
      <div className="flex text-daintree-400">
        <div className="flex flex-grow items-center gap-2 px-4 py-2 text-sm">
          Account {accountIndex}
        </div>
        <div className="flex items-center justify-center p-3">
          <div className="items-center">
            <Tooltip
              id="addedFeedback"
              style={{
                backgroundColor: "#203C49",
                fontSize: "12px",
                fontWeight: 600,
                padding: "8px",
                opacity: 1,
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

      {/* Display Kaspa address and balance */}
      <div className="flex flex-grow items-center justify-between border-t border-daintree-700 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <img alt="kaspa" src={kaspaIcon} className="h-8 w-8"></img>
          <HoverShowAllCopy
            text={address}
            place="top"
            className="cursor-pointer"
          >
            {shrinkAddress}
          </HoverShowAllCopy>
        </div>
        <div>
          {accountBalance !== undefined ? (
            <div className="flex flex-grow flex-col items-end">
              <span className="font-semibold">
                {formatToken(accountBalance)}
              </span>
              <span className="text-xs text-daintree-400">
                {formatCurrency(totalBalanceCurrency, currencyCode)}
              </span>
            </div>
          ) : (
            <div className="h-[40px] w-[100px] animate-pulse self-center rounded-xl bg-daintree-700" />
          )}
        </div>
      </div>

      {/* Display EVM address if available */}
      {evmPublicKey &&
        supportedEvmL2Chains.map((chain) => (
          <EvmAddressItem
            key={chain.id}
            address={evmPublicKey}
            chainId={numberToHex(chain.id)}
          />
        ))}
    </div>
  );
}
