import { EvmAssetsContext } from "@/contexts/EvmAssets";
import { useContext } from "react";

export default function useEvmAssets() {
  return useContext(EvmAssetsContext);
}
