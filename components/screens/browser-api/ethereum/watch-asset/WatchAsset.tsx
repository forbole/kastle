import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import { twMerge } from "tailwind-merge";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { ApiUtils } from "@/api/background/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { RPC_ERRORS } from "@/api/message";
import useEvmAssets from "@/hooks/evm/useEvmAssets";
import useWalletManager from "@/hooks/useWalletManager";
import {
  erc20OptionsSchema,
  watchAssetSchema,
} from "@/api/background/handlers/ethereum/watchAsset";

export default function WatchAsset() {
  const [settings, , isSettingsLoading] = useSettings();
  const { saveEvmAssets, isEvmAssetsLoading } = useEvmAssets();
  const { account } = useWalletManager();

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const payload = new URLSearchParams(window.location.search).get("payload");
  const parsed = payload
    ? watchAssetSchema.parse(JSON.parse(decodeURIComponent(payload)))
    : undefined;

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      iconColor: "bg-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      iconColor: "bg-yellow-500",
      background: "bg-yellow-800",
    },
  ];
  const selectedNetwork = networks.find(
    (n) => n.id === (settings?.networkId ?? NetworkType.Mainnet),
  );

  const cancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(
        requestId,
        null,
        RPC_ERRORS.USER_REJECTED_REQUEST,
      ),
    );
    window.close();
  };

  const isLoading =
    !account || isSettingsLoading || !parsed || isEvmAssetsLoading;
  const onConfirm = async () => {
    if (isLoading) {
      return;
    }

    try {
      await saveEvmAssets((prev) => {
        const address = account.address;
        const walletEvmAssets = prev?.[address] ?? {};

        switch (parsed.type) {
          case "ERC20": {
            const erc20Options = erc20OptionsSchema.parse(parsed.options);

            if (!walletEvmAssets.erc20) {
              walletEvmAssets.erc20 = [];
            }

            const existingAsset = walletEvmAssets.erc20?.find(
              (asset) =>
                asset.address.toLowerCase() ===
                erc20Options.address.toLowerCase(),
            );

            if (existingAsset) {
              break;
            }

            if (!erc20Options.chainId) {
              throw new Error("Chain ID is required for ERC20 assets");
            }

            // Add the new ERC20 asset
            walletEvmAssets.erc20.push({
              address: erc20Options.address,
              symbol: erc20Options.symbol,
              decimals: erc20Options.decimals,
              image: erc20Options.image,
              chainId: erc20Options.chainId,
            });
            break;
          }
        }

        return {
          ...prev,
          [address]: walletEvmAssets,
        };
      });

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, true),
      );
    } catch (error) {
      console.error("Error adding Evm assets:", error);
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, RPC_ERRORS.INTERNAL_ERROR),
      );
    } finally {
      window.close();
    }
  };

  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div>
        <Header showPrevious={false} showClose={false} title="Add Asset" />
        <div className="relative">
          <img src={signImage} alt="Sign" className="mx-auto" />
          <div
            className={twMerge(
              "absolute right-0 top-0 flex items-center gap-2 rounded-full px-2",
              selectedNetwork?.text,
              selectedNetwork?.background,
            )}
          >
            <i
              className={twMerge(
                "rounded-full p-1",
                selectedNetwork?.iconColor,
              )}
            />
            {selectedNetwork?.name}
          </div>

          {/* Confirm Content */}
          <div className="text-center">
            <p className="mt-2 text-base text-daintree-400">
              Please confirm the asset you are adding
            </p>
            <div className="mt-4 rounded-md bg-daintree-700 p-4">
              <p className="overflow-auto whitespace-pre text-start text-sm">
                {JSON.stringify(parsed, null, 2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 text-base font-semibold">
        <button className="rounded-full p-5 text-[#7B9AAA]" onClick={cancel}>
          Cancel
        </button>

        <button
          className="flex flex-auto items-center justify-center rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
          onClick={onConfirm}
          disabled={isLoading}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
