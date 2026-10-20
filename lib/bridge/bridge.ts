// Bridge routes, fee math and validation shared by the bridge hook and its
// unit spec. No wasm, so tests can import it.

import kurveLogo from "@/assets/images/providers/kurve-logo.png";
import kasplexLogo from "@/assets/images/network-logos/kasplex.svg";

// Igra was removed: KAT blocked the Igra chain (38833).
export type BridgeChain = "kaspa" | "kasplex";
export type BridgeDirection = "kas-kasplex" | "kasplex-kas";

export const BRIDGE_ROUTES: Record<
  BridgeDirection,
  {
    from: BridgeChain;
    to: BridgeChain;
    provider: string;
    logo: string;
    estTime: string;
  }
> = {
  "kas-kasplex": {
    from: "kaspa",
    to: "kasplex",
    provider: "Kurve Bridge",
    logo: kurveLogo,
    estTime: "~60s",
  },
  "kasplex-kas": {
    from: "kasplex",
    to: "kaspa",
    provider: "Kasplex Bridge",
    logo: kasplexLogo,
    estTime: "~60s",
  },
};

export const BRIDGE_TOKEN_NAME: Record<BridgeChain, string> = {
  kaspa: "KAS",
  kasplex: "KAS",
};

export const bridgeDirectionsFrom = (from: BridgeChain) =>
  (Object.keys(BRIDGE_ROUTES) as BridgeDirection[]).filter(
    (d) => BRIDGE_ROUTES[d].from === from,
  );

export const KASTLE_FEE_ADDRESS = {
  mainnet:
    "kaspa:qzy6me2q7tdgn863uhu52rwdruq6u2rx0e6y4dvj3k9yl3aqnjt7jh077p3s3",
  testnet:
    "kaspatest:qrdk4gs8y5dvw57qh0pxrg6xts9khwamy7php9gfxe9tr57vftffcexzsulw6",
};

// Still read by the Activity feed to list past Igra deposits.
export const IGRA_ENTRY_ADDRESS = {
  mainnet:
    "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n",
  testnet:
    "kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw",
};

export const KURVE_ENTRY_ADDRESS = {
  mainnet:
    "kaspa:qypr0qj7luv26laqlquan9n2zu7wyen87fkdw3kx3kd69ymyw3tj4tsh467xzf2",
  testnet:
    "kaspatest:qyp7xxc2c2u0rs6uhgrs88ljjd0tlgjjxnu5a48899xmma894p68mggzct64wuu",
};

export const KASPLEX_BRIDGE_CONTRACT = {
  mainnet: "0x34606e6d01280f49791628b311cf33a808d1f7c6",
  testnet: "0x6181D079FE60b44077E7a461d31519A53124FD54",
} as const;

// Kastle fee on L1 → L2: fixed 0.2 KAS + 0.75%, paid as an extra output.
export const KASTLE_BRIDGE_BASE_FEE = 0.2;
export const KASTLE_BRIDGE_FEE_RATE = 0.0075;
// Kurve's own fee, shown to the user but taken upstream.
export const KURVE_SERVICE_FEE = 0.5;
// Kasplex → Kaspa upstream fee, display only.
export const KASPLEX_EXIT_FEE_RATE = 0.005;

export const kastleL1BridgeFee = (amount: number) =>
  KASTLE_BRIDGE_BASE_FEE + amount * KASTLE_BRIDGE_FEE_RATE;

/** Smallest gross amount whose net (after the Kastle fee) reaches minNet, 2dp up. */
export const minGrossForNet = (minNet: number) =>
  Math.ceil(
    ((minNet + KASTLE_BRIDGE_BASE_FEE) / (1 - KASTLE_BRIDGE_FEE_RATE)) * 100,
  ) / 100;

type L1Ctx = { balance: number; networkFee: number };

function checkL1Funds(amount: number, { balance, networkFee }: L1Ctx) {
  if (amount > balance) return "Oh, you don't have enough funds";
  if (amount + networkFee > balance)
    return "Oh, you need KAS for the network fees";
  return undefined;
}

export function validateKasToKasplex(amount: number, ctx: L1Ctx) {
  if (amount - kastleL1BridgeFee(amount) < 1) {
    return `Oh, minimum bridge amount is ${minGrossForNet(1)} KAS`;
  }
  return checkL1Funds(amount, ctx);
}

// Kurve (kasplex-kas) bridge minimum exit amount, in KAS.
export const KURVE_MIN_EXIT_KAS = 10;

export function validateKurveExitAmount(amount: number): string | undefined {
  if (amount < KURVE_MIN_EXIT_KAS) {
    return `Oh, minimum bridge amount is ${KURVE_MIN_EXIT_KAS} KAS`;
  }
  return undefined;
}
