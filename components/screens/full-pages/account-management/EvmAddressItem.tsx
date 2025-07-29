import useEvmKasBalanceByAddress from "@/hooks/evm/useEvmKasBalanceByAddress";
import { getChainImage } from "@/lib/layer2";
import { formatCurrency, formatToken, textEllipsis } from "@/lib/utils";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useCurrencyValue from "@/hooks/useCurrencyValue";

type EvmAddressItemProps = {
  address: `0x${string}`;
  chainId: `0x${string}`;
};

export default function EvmAddressItem({
  address,
  chainId,
}: EvmAddressItemProps) {
  const { data: balanceData } = useEvmKasBalanceByAddress(address, chainId);
  const balance = parseFloat(balanceData?.balance ?? "0");

  const kaspaPrice = useKaspaPrice();

  const fiatBalance = (balance ?? 0) * kaspaPrice.kaspaPrice;
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

  const shrinkAddress = textEllipsis(address);

  return (
    <div className="flex flex-grow items-center justify-between border-t border-daintree-700 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <img
          alt={chainId}
          src={getChainImage(chainId)}
          className="h-8 w-8"
        ></img>
        <HoverShowAllCopy text={address} place="top" className="cursor-pointer">
          {shrinkAddress}
        </HoverShowAllCopy>
      </div>
      <div>
        {balanceData !== undefined ? (
          <div className="flex flex-grow flex-col items-end">
            <span className="font-semibold">{formatToken(balance)}</span>
            <span className="text-xs text-daintree-400">
              {formatCurrency(totalBalanceCurrency, currencyCode)}
            </span>
          </div>
        ) : (
          <div className="h-[40px] w-[100px] animate-pulse self-center rounded-xl bg-daintree-700" />
        )}
      </div>
    </div>
  );
}
