import Layer2AssetImage from "@/components/Layer2AssetImage";
import kasIcon from "@/assets/images/kas-icon.svg";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import { useNavigate } from "react-router-dom";
import { getChainImage } from "@/lib/layer2";

export default function EvmKasSelectItem({
  chainId,
}: {
  chainId: `0x${string}`;
}) {
  const navigate = useNavigate();
  const { data } = useEvmKasBalance(chainId);
  const kasBalance = data?.balance ?? "0";
  const onClick = () => {
    navigate(`/evm-kas/send/${chainId}`);
  };

  return (
    <>
      {kasBalance !== "0" && (
        <button
          type="button"
          className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
          onClick={onClick}
        >
          <div className="flex items-center gap-2">
            <Layer2AssetImage
              tokenImage={kasIcon}
              tokenImageSize={24}
              chainImageSize={20}
              chainImage={getChainImage(chainId)}
            />
            <span>KAS</span>
          </div>
          <span>{kasBalance}</span>
        </button>
      )}
    </>
  );
}
