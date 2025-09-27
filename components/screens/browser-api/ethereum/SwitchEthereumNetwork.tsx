import { z } from "zod";
import {
  TESTNET_SUPPORTED_EVM_L2_CHAINS,
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { numberToHex } from "viem";
import UnsupportedNetwork from "./switch-network/UnsupportedNetwork";
import SwitchNetwork from "./switch-network/SwitchNetwork";
import { useSettings } from "@/hooks/useSettings";

export default function SwitchKaspaNetwork() {
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "network",
  );
  const [settings] = useSettings();
  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;
  const evmChainId = payload ? z.number().parse(parseInt(payload, 10)) : null;

  const supportEvmL2s =
    settings?.networkId === "mainnet"
      ? MAINNET_SUPPORTED_EVM_L2_CHAINS
      : TESTNET_SUPPORTED_EVM_L2_CHAINS;

  const isSupported = supportEvmL2s.some((chain) => chain.id === evmChainId);

  return (
    <>
      {requestId && evmChainId && isSupported && (
        <SwitchNetwork
          requestId={requestId}
          chainId={numberToHex(evmChainId)}
        />
      )}
      {requestId && evmChainId && !isSupported && (
        <UnsupportedNetwork requestId={requestId} />
      )}
    </>
  );
}
