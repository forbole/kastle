import { Address, Hex, hexToNumber } from "viem";
import zealousLogo from "@/assets/images/providers/zealous-swap-logo.png";
import kaspaComLogo from "@/assets/images/providers/kaspa-com-logo.png";
import { igraMainnet } from "@/lib/layer2";

export const KASPLEX_WKAS_ADDRESS =
  "0x2c2Ae87Ba178F48637acAe54B87c3924F544a83e";

export const IGRA_WKAS_ADDRESS = "0x17Ec7E1768c813E2a3a9b0f94A35605CA520C242";

export const KASPA_COM_PARTNER_KEY =
  "0x6b6173746c650000000000000000000000000000000000000000000000000000";

/**
 * Returns the WKAS (wrapped KAS) address for a given chain.
 */
export function getWkasAddress(chainId?: Hex): Address {
  if (chainId && hexToNumber(chainId) === igraMainnet.id) {
    return IGRA_WKAS_ADDRESS as Address;
  }
  return KASPLEX_WKAS_ADDRESS as Address;
}

export const KASPLEX_FEE_COLLECTOR_SWAP_ADDRESS: Address =
  "0xdfa17269221ce9fdba5bbd28f209a3a23b738978";

export const IGRA_FEE_COLLECTOR_SWAP_ADDRESS: Address =
  "0x2f15c748a51438d02347878a2a0f26bc35b5e938";

export interface SwapProvider {
  name: string;
  routerAddress: Address;
  factoryAddress: Address;
  proxyAddress?: Address;
  /** FeeCollector address — when set, swaps are routed through it instead of the router directly */
  feeCollectorAddress?: Address;
  image?: string;
}

export const KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER: SwapProvider = {
  name: "Zealous Swap",
  routerAddress: "0xA5B0946D31aD2d251e0fe2dfEA8808BFd475e607",
  factoryAddress: "0x98Bb580A77eE329796a79aBd05c6D2F2b3D5E1bD",
  feeCollectorAddress: KASPLEX_FEE_COLLECTOR_SWAP_ADDRESS,
  image: zealousLogo,
};

/**
 * KaspaCom on Kasplex mainnet (chainId 202555).
 *
 * Addresses from @kaspacom/swap-sdk v1.1.27 `NETWORKS.kasplex` (read
 * 2026-08-25); each re-checked with eth_getCode against
 * https://evmrpc.kasplex.org on 2026-08-25 — router 17649 B, factory 13046 B,
 * proxy 6151 B. The proxy answers WETH() with KASPLEX_WKAS_ADDRESS.
 */
export const KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER: SwapProvider = {
  name: "KaspaCom",
  routerAddress: "0x3a1f0bD164fe9D8fa18Da5abAB352dC634CA5F10",
  factoryAddress: "0xa9CBa43A407c9Eb30933EA21f7b9D74A128D613c",
  proxyAddress: "0x4c5BEaAE83577E3a117ce2F477fC42a1EA39A8a3",
  image: kaspaComLogo,
};

export const IGRA_MAINNET_ZEALOUS_SWAP_PROVIDER: SwapProvider = {
  name: "Zealous Swap",
  routerAddress: "0xA5B0946D31aD2d251e0fe2dfEA8808BFd475e607",
  factoryAddress: "0x98Bb580A77eE329796a79aBd05c6D2F2b3D5E1bD",
  feeCollectorAddress: IGRA_FEE_COLLECTOR_SWAP_ADDRESS,
  image: zealousLogo,
};

/**
 * KaspaCom on IGRA mainnet (chainId 38833).
 *
 * Addresses from @kaspacom/swap-sdk v1.1.27 `NETWORKS.igra` (read 2026-08-25);
 * every one re-checked with eth_getCode against https://rpc.igralabs.com:8545
 * on 2026-08-25 — router 17768 B, factory 13046 B, proxy 6158 B.
 *
 * proxyAddress was 0x47f80b6d…, which is KaspaCom's igra-TESTNET *router*
 * (chainId 38836): wrong network and wrong field at once. eth_getCode answers
 * "0x" for it on Igra AND on Kasplex, and a call to a codeless address does not
 * revert — it succeeds, executes nothing and keeps any native value attached,
 * so every KaspaCom-on-Igra swap in that window paid into an address that
 * could not execute. The incident report counts 7 txs from 4 users between
 * 2026-07-03 and 2026-08-16, 2 iKAS unrecoverable; those counts come from the
 * report, the codeless proxy is chain-checked.
 * The proxy below answers WETH() with IGRA_WKAS_ADDRESS, which is how it was
 * confirmed to be the Igra deployment rather than another chain's.
 */
export const IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER: SwapProvider = {
  name: "KaspaCom",
  routerAddress: "0x771dfB21e1CD8EA3e8B68cB2469eDaF9548c2523",
  factoryAddress: "0x21350BcDa9E81731CF4cDE3DbC457e3de2739c01",
  proxyAddress: "0xDD1aBB133D027f4F67571b5bEEDC9cd9a93C13Ca",
  image: kaspaComLogo,
};

export const ALL_SWAP_PROVIDERS: SwapProvider[] = [
  KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER,
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER,
  IGRA_MAINNET_ZEALOUS_SWAP_PROVIDER,
  IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER,
];

/**
 * Returns the available swap providers for a given chain.
 */
export function getSwapProvidersForChain(chainId?: Hex): SwapProvider[] {
  if (chainId && hexToNumber(chainId) === igraMainnet.id) {
    return [
      IGRA_MAINNET_ZEALOUS_SWAP_PROVIDER,
      IGRA_MAINNET_KASPA_COM_SWAP_PROVIDER,
    ];
  }
  return [
    KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER,
    KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER,
  ];
}

/** Case-insensitive equality of two optional addresses; absent equals absent. */
function sameAddress(a?: string, b?: string): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

/**
 * The addresses a provider record acts through. Structural (not SwapProvider)
 * so both this module's records and the swap form's own provider shape fit.
 */
interface SwapProviderAddresses {
  routerAddress: string;
  feeCollectorAddress?: string;
  proxyAddress?: string;
}

/**
 * Two provider records describe the same deployment only when EVERY address
 * they act through matches — router AND fee collector AND proxy.
 *
 * The router alone cannot discriminate: Zealous's routerAddress and
 * factoryAddress are byte-identical on Kasplex and Igra (see the two
 * ZEALOUS_SWAP_PROVIDER records above) and only feeCollectorAddress differs.
 * A router-only comparison therefore accepts a provider object from the OTHER
 * chain — whose collector has no code where the swap is being signed
 * (eth_getCode for Kasplex's 0xdfa17269… on Igra answers "0x", checked
 * 2026-08-25), so a swap sent to it executes no calldata at all and any native
 * value attached is transferred to the codeless address and stranded.
 */
export function isSameSwapProvider(
  a: SwapProviderAddresses,
  b: SwapProviderAddresses,
): boolean {
  return (
    sameAddress(a.routerAddress, b.routerAddress) &&
    sameAddress(a.feeCollectorAddress, b.feeCollectorAddress) &&
    sameAddress(a.proxyAddress, b.proxyAddress)
  );
}

/**
 * The given chain's own record of the provider carrying this name, or null
 * when that chain deploys no such venue.
 *
 * This is how the execution path must obtain the provider it signs against:
 * resolving by name through the chain being signed for makes it impossible to
 * pair one chain's wallet client with another chain's collector or proxy,
 * whatever stale object a form or cache still holds.
 *
 * `chainId` keeps getSwapProvidersForChain's Kasplex-for-unknown default so
 * the two functions cannot disagree about a chain's provider set; callers on
 * the money path verify the chain is a supported one before resolving.
 */
export function resolveSwapProviderForChain(
  name: string,
  chainId?: Hex,
): SwapProvider | null {
  return getSwapProvidersForChain(chainId).find((p) => p.name === name) ?? null;
}
