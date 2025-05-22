import { twMerge } from "tailwind-merge";
import React from "react";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { applyDecimal } from "@/lib/krc20.ts";
import TickerSelectItem from "@/components/send/TickerSelectItem.tsx";
import kasIcon from "@/assets/images/kas-icon.svg";
import { formatToken } from "@/lib/utils.ts";
import { useFormContext } from "react-hook-form";
import { SendFormData } from "@/components/screens/Send.tsx";

type TickerSelectProps = { isShown: boolean; toggleShow: () => void };

export default function TickerSelect({
  isShown,
  toggleShow,
}: TickerSelectProps) {
  const { setValue } = useFormContext<SendFormData>();
  const { wallet, account } = useWalletManager();
  const [searchQuery, setSearchQuery] = useState("");

  const address = account?.address;
  const balance = account?.balance;
  const hasSearchQuery = searchQuery === "";
  const isKasShown =
    hasSearchQuery || "kas".startsWith(searchQuery.toLowerCase());

  const tokenListItems = useTokenListByAddress(address ?? undefined);

  const tokens = tokenListItems
    ?.filter((token) =>
      hasSearchQuery
        ? true
        : token.id.toLowerCase().startsWith(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      const { toFloat: aToFloat } = applyDecimal(a.dec);
      const { toFloat: bToFloat } = applyDecimal(b.dec);

      return (
        bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
      );
    });

  const selectToken = async (tokenId: string) => {
    setValue("ticker", tokenId, { shouldValidate: true });
    toggleShow();
  };

  const isLedger = wallet?.type === "ledger";

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={toggleShow}
      />

      {/* Pop over */}
      <div
        className={twMerge(
          "no-scrollbar absolute bottom-0 left-0 z-50 h-[80vh] w-full transform rounded-t-2xl border border-daintree-700 bg-daintree-800 transition-transform duration-300 ease-out",
          isShown ? "translate-y-0" : "translate-y-[80vh]",
        )}
      >
        <div className="relative m-4 max-w-sm space-y-3">
          <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-4 text-daintree-400 peer-disabled:pointer-events-none peer-disabled:opacity-50">
            <i className="hn hn-search"></i>
          </div>

          <input
            type="text"
            className="block w-full rounded-lg border-daintree-700 bg-[#051D26] py-3 pe-4 ps-10 text-sm text-white placeholder-daintree-400 focus:border-daintree-700 focus:ring-daintree-700 disabled:pointer-events-none disabled:opacity-50"
            placeholder="Search token"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="no-scrollbar mx-2 flex flex-col overflow-y-scroll">
          {/* KAS */}
          {isKasShown && (
            <button
              type="button"
              className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
              onClick={() => selectToken("kas")}
            >
              <div className="flex items-center gap-2">
                <img
                  alt="castle"
                  className="h-[24px] w-[24px] rounded-full"
                  src={kasIcon}
                />
                <span>KAS</span>
              </div>
              <span>{formatToken(parseFloat(balance ?? "0"))}</span>
            </button>
          )}

          {tokens?.map((token) => (
            <TickerSelectItem
              key={token.id}
              token={token}
              selectToken={selectToken}
              supported={!isLedger}
            />
          ))}

          {!isKasShown && tokens?.length === 0 && (
            <span className="text-center text-base font-medium text-daintree-400">
              No result found
            </span>
          )}
        </div>
      </div>
    </>
  );
}
