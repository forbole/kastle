import { twMerge } from "tailwind-merge";
import React from "react";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { applyDecimal } from "@/lib/krc20.ts";
import Krc20SelectItem from "@/components/send/token-selector/Krc20SelectItem";
import kasIcon from "@/assets/images/kas-icon.svg";
import { formatToken } from "@/lib/utils.ts";
import { useNavigate } from "react-router-dom";
import EvmKasSelectItems from "./EvmKasSelectItems";
import Erc20SelectItems from "./Erc20SelectItems";
import { useFormContext } from "react-hook-form";

type TokenSelectProps = { isShown: boolean; toggleShow: () => void };

export default function TokenSelect({ isShown, toggleShow }: TokenSelectProps) {
  const navigate = useNavigate();
  const { wallet, account } = useWalletManager();
  const [searchQuery, setSearchQuery] = useState("");
  const { watch } = useFormContext<{
    userInput?: string;
    amount?: string;
  }>();
  const { userInput, amount } = watch();

  const kasAddress = account?.address;
  const kasBalance = account?.balance;
  const hasSearchQuery = searchQuery === "";
  const isKasShown =
    hasSearchQuery || "kas".startsWith(searchQuery.toLowerCase());

  const tokenListItems = useTokenListByAddress(kasAddress ?? undefined);

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

  const selectToken = async (type: string, tokenId?: string) => {
    if (type === "kas") {
      navigate("/kas/send", {
        state: {
          step: "details",
          form: {
            userInput,
            amount,
          },
        },
      });
    } else {
      navigate(`/krc-20/send/${tokenId}`, {
        state: {
          step: "details",
          form: {
            userInput,
            amount,
          },
        },
      });
    }
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
              <span>{formatToken(parseFloat(kasBalance ?? "0"))}</span>
            </button>
          )}

          {/* EVM KAS */}
          {isKasShown && <EvmKasSelectItems toggleShow={toggleShow} />}

          <Erc20SelectItems searchQuery={searchQuery} toggleShow={toggleShow} />

          {tokens
            ?.filter((token) => parseFloat(token.balance) > 0)
            .map((token) => (
              <Krc20SelectItem
                key={token.id}
                token={token}
                selectToken={(tokenId) => selectToken("krc20", tokenId)}
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
