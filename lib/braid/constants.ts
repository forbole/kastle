export const BRAID_PROVIDER = { id: "braid", name: "Braid" } as const;

// The router API the SDK pins for Kaspa mainnet.
export const BRAID_API = {
  mainnet: "https://app.braidswap.com/api/mainnet/router",
} as const;

// The most a deposit's network fee can be: the SDK's LIM.feeMax
// (@braid_swap/sdk src/l1/constants.js), above which its verify refuses the
// build ("deposit network fee out of range"). Not exported by the SDK.
export const BRAID_DEPOSIT_FEE_MAX = 10_000_000n; // 0.1 KAS

/**
 * Kastle's integrator fee on Braid swaps. No fee address is set, so quotes
 * and builds go out without an integrator block and no Kastle fee is
 * charged. A zero bps likewise means no integrator fee is sent. An address
 * here is paid by every Braid swap, so it must be one agreed with Braid.
 */
export const BRAID_INTEGRATOR_FEE: {
  feeAddress: string | undefined;
  feeBps: number;
} = { feeAddress: undefined, feeBps: 0 };

/** The Kastle fee a quote actually carries: none without an address. */
export const BRAID_KASTLE_FEE_BPS = BRAID_INTEGRATOR_FEE.feeAddress
  ? BRAID_INTEGRATOR_FEE.feeBps
  : 0;
