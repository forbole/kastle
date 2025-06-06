import WatchAsset from "./watch-asset/WatchAsset";
import { EVMAssetsProvider } from "@/contexts/EvmAssets";

export default function EvmWatchAssetConfirm() {
  return (
    <EVMAssetsProvider>
      <WatchAsset />
    </EVMAssetsProvider>
  );
}
