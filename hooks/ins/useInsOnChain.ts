import useSWR from "swr";
import { getInsTarget, lookupInsNameOnChain } from "@/lib/ins/insRegistry";

export interface InsOnChainRecord {
  registry: `0x${string}`;
  tokenId: bigint;
  /** Ground truth for ownership, and the address a send resolves to. */
  owner: `0x${string}`;
  /**
   * Where the name currently routes funds. `undefined` means targetOf itself
   * failed -- treat that as unknown, never as "no target set".
   */
  target: `0x${string}` | undefined;
}

/**
 * The on-chain identity of a .igra name: who owns it, and where it routes.
 *
 * Fails closed. Any lookup error leaves `record` undefined and sets `reason`,
 * so callers gate owner-only actions on `record` existing rather than on the
 * absence of an error.
 *
 * The registry address and token id always come back together from a single
 * lookup: V1 and V2 namespace ids separately, so pairing a v2 id with the v1
 * address would act on a different name entirely.
 */
export default function useInsOnChain(name: string | undefined) {
  const { data, isLoading, mutate } = useSWR(
    name ? `ins-onchain:${name}` : null,
    async (): Promise<{ record?: InsOnChainRecord; reason?: string }> => {
      const result = await lookupInsNameOnChain(name!);
      if (!result.ok) return { reason: result.reason };

      return {
        record: {
          registry: result.registry,
          tokenId: result.tokenId,
          owner: result.address,
          target: await getInsTarget(result.registry, result.tokenId),
        },
      };
    },
    { revalidateOnFocus: false },
  );

  return {
    record: data?.record,
    reason: data?.reason,
    isLoading,
    refresh: mutate,
  };
}
