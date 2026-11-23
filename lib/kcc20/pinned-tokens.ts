import type { KronNetwork } from "./index";

/**
 * Tokens Kastle knows by covenant id, per network. A ticker is not an identity:
 * anyone can deploy a token called "kUSDT". Data only, shipped with the release;
 * never fetched, so no remote source can mark an impostor known.
 */
export type PinnedToken = {
  covenantId: string;
  symbol: string;
  name: string;
  decimals: number;
};

export const PINNED_TOKENS: Partial<Record<KronNetwork, PinnedToken[]>> = {
  mainnet: [
    {
      covenantId:
        "50b3477e7368d0c5bfbd64483b4607350ec411377972f33e40b2d4b6d1513fd3",
      symbol: "kUSDT",
      name: "kUSDT",
      decimals: 6,
    },
  ],
};
