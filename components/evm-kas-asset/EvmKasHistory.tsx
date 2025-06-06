import kasIcon from "@/assets/images/kas-icon.svg";
import { ALL_SUPPORTED_EVM_L2_CHAINS, getChainImage } from "@/lib/layer2";
import { numberToHex } from "viem";
import { toEvmAddress } from "@/lib/utils";
import Layer2AssetImage from "../Layer2AssetImage";

export default function EvmKasHistory({ chainId }: { chainId: `0x${string}` }) {
  const { account } = useWalletManager();

  const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (c) => numberToHex(c.id) === chainId,
  );

  const address = account?.publicKeys?.[0]!;
  const evmAddress = toEvmAddress(address);

  const openTransaction = () => {
    browser.tabs.create({
      url: `${chain?.blockExplorers.default.url}/address/${evmAddress}`,
    });
  };

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
        onClick={() => openTransaction()}
      >
        <Layer2AssetImage
          tokenImage={kasIcon}
          chainImage={getChainImage(chainId)}
        />
        <span className="text-base font-medium">
          See activity history in explorer
        </span>
        <i className="hn hn-external-link text-[20px] text-daintree-400"></i>
      </button>
    </div>
  );
}
