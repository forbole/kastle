import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { isCovenantTxJson } from "@/api/background/handlers/kaspa/utils";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import { decodeCovenantRequest } from "./dapp-request";
import { walletKcc20Pieces } from "./wallet-pieces";

/**
 * The confirm screen's own decode of a covenant (version 1+) dApp request:
 * re-run here so the screen never renders from anything but the signed tx.
 * Version 0: `isCovenant` false and nothing is fetched.
 */
export function useDappCovenantDecode(txJson: string, address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useRpcClientStateful();
  const network = settings?.networkId;
  const isCovenant = isCovenantTxJson(txJson);

  const { data, error } = useSWR(
    isCovenant && address && rpcClient && network
      ? ["dappCovenantDecode", txJson, address, network]
      : null,
    async () =>
      decodeCovenantRequest(
        deserializeTransaction(txJson),
        await walletKcc20Pieces(address!, rpcClient!, {
          network: network!,
          // The standard-family flag gates display, not this guard: a hidden
          // piece must still show as leaving. Mainnet-only kascov read.
          standard: true,
        }),
        network!,
      ),
    // A failure stays failed: the user cancels, the dApp asks again.
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  const status: "loading" | "ready" | "failed" =
    error || data?.ok === false ? "failed" : data ? "ready" : "loading";
  return {
    isCovenant,
    status,
    movements: data?.ok ? data.movements : [],
  };
}
