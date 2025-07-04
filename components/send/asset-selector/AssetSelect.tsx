import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { applyDecimal } from "@/lib/krc20.ts";
import Krc20SelectItem from "@/components/send/asset-selector/Krc20SelectItem";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { formatToken } from "@/lib/utils.ts";
import { useNavigate } from "react-router-dom";
import EvmKasSelectItems from "./EvmKasSelectItems";
import Header from "@/components/GeneralHeader";
import useErc20Assets from "@/hooks/evm/useErc20Assets";
import Erc20SelectItem from "./Erc20SelectItem";

export default function AssetSelect() {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const [searchQuery, setSearchQuery] = useState("");
  const kasAddress = account?.address;
  const kasBalance = account?.balance;
  const hasSearchQuery = searchQuery === "";
  const isKasShown =
    hasSearchQuery || "kas".startsWith(searchQuery.toLowerCase());

  const tokenListItems = useTokenListByAddress(kasAddress ?? undefined);
  const { assets } = useErc20Assets();

  const filteredErc20Assets = assets.filter((asset) =>
    hasSearchQuery
      ? true
      : asset.symbol.toLowerCase().startsWith(searchQuery.toLowerCase()),
  );
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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-4 pt-4">
        <Header title="Select Asset" onClose={() => navigate("/dashboard")} />
        <div className="relative flex items-center pb-4">
          <div className="pointer-events-none absolute start-0 flex items-center ps-4 leading-none text-daintree-400 peer-disabled:pointer-events-none peer-disabled:opacity-50">
            <i className="hn hn-search text-base font-medium"></i>
          </div>

          <input
            type="text"
            className="block w-full rounded-lg border-daintree-700 bg-daintree-800 py-3 pe-4 ps-10 text-sm text-white placeholder-daintree-400 focus:border-daintree-700 focus:ring-daintree-700 disabled:pointer-events-none disabled:opacity-50"
            placeholder="Search token"
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="thin-scrollbar mb-4 mr-1 flex flex-1 flex-col overflow-y-scroll pl-4 pr-3">
        {/* KAS */}
        {isKasShown && (
          <button
            type="button"
            className="flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
            onClick={() => navigate("/kas/send")}
          >
            <div className="flex items-center gap-2">
              <img
                alt="castle"
                className="h-10 w-10 rounded-full"
                src={kasIcon}
              />
              <div className="flex flex-col items-start">
                <span>KAS</span>
                <span></span>
              </div>
            </div>
            <span>{formatToken(parseFloat(kasBalance ?? "0"))}</span>
          </button>
        )}

        {/* EVM KAS */}
        {isKasShown && <EvmKasSelectItems />}

        {/* ERC20 Assets */}
        {filteredErc20Assets.map((asset) => (
          <Erc20SelectItem
            key={`${asset.chainId}-${asset.address}`}
            asset={asset}
          />
        ))}

        {tokens
          ?.filter((token) => parseFloat(token.balance) > 0)
          .map((token) => <Krc20SelectItem key={token.id} token={token} />)}

        {!isKasShown &&
          tokens?.length === 0 &&
          filteredErc20Assets.length === 0 && (
            <span className="text-center text-base font-medium text-daintree-400">
              No result found
            </span>
          )}
      </div>
    </div>
  );
}
