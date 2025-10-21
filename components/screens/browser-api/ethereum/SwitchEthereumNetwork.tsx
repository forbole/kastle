import { z } from "zod";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { numberToHex } from "viem";
import UnsupportedNetwork from "./switch-network/UnsupportedNetwork";
import SwitchNetwork from "./switch-network/SwitchNetwork";

export default function SwitchKaspaNetwork() {
  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "network",
  );
  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;
  const evmChainId = payload ? z.number().parse(parseInt(payload, 10)) : null;

  const isSupported = ALL_SUPPORTED_EVM_L2_CHAINS.some(
    (chain) => chain.id === evmChainId,
  );

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
