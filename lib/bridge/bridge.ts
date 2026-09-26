// Bridge routes, fee math and validation shared by the bridge hook and its
// unit spec. Pure on purpose: no wasm, no images, so tests can import it.

export type BridgeChain = "kaspa" | "kasplex" | "igra";
export type BridgeDirection =
  | "kas-igra"
  | "kas-kasplex"
  | "kasplex-kas"
  | "igra-kas";

export const BRIDGE_ROUTES: Record<
  BridgeDirection,
  {
    from: BridgeChain;
    to: BridgeChain;
    provider: string;
    estTime: string;
    mainnetOnly?: boolean;
  }
> = {
  "kas-igra": { from: "kaspa", to: "igra", provider: "IGRA Bridge", estTime: "~60s" },
  "kas-kasplex": { from: "kaspa", to: "kasplex", provider: "Kurve Bridge", estTime: "~60s" },
  "kasplex-kas": { from: "kasplex", to: "kaspa", provider: "Kasplex Bridge", estTime: "~60s" },
  // Testnet has no KAT fee collector deployed.
  "igra-kas": { from: "igra", to: "kaspa", provider: "KAT Bridge", estTime: "~8-12 min", mainnetOnly: true },
};

export const BRIDGE_TOKEN_NAME: Record<BridgeChain, string> = {
  kaspa: "KAS",
  kasplex: "KAS",
  igra: "iKAS",
};

export const bridgeDirectionsFrom = (from: BridgeChain, isMainnet: boolean) =>
  (Object.keys(BRIDGE_ROUTES) as BridgeDirection[]).filter(
    (d) =>
      BRIDGE_ROUTES[d].from === from &&
      (isMainnet || !BRIDGE_ROUTES[d].mainnetOnly),
  );

export const KASTLE_FEE_ADDRESS = {
  mainnet: "kaspa:qzy6me2q7tdgn863uhu52rwdruq6u2rx0e6y4dvj3k9yl3aqnjt7jh077p3s3",
  testnet: "kaspatest:qrdk4gs8y5dvw57qh0pxrg6xts9khwamy7php9gfxe9tr57vftffcexzsulw6",
};

export const IGRA_ENTRY_ADDRESS = {
  mainnet: "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n",
  testnet: "kaspatest:qqmstl2znv9tsfgcmj9shme82my867tapz7pdu4ztwdn6sm9452jj5mm0sxzw",
};

export const KURVE_ENTRY_ADDRESS = {
  mainnet: "kaspa:qypr0qj7luv26laqlquan9n2zu7wyen87fkdw3kx3kd69ymyw3tj4tsh467xzf2",
  testnet: "kaspatest:qyp7xxc2c2u0rs6uhgrs88ljjd0tlgjjxnu5a48899xmma894p68mggzct64wuu",
};

export const KASPLEX_BRIDGE_CONTRACT = {
  mainnet: "0x34606e6d01280f49791628b311cf33a808d1f7c6",
  testnet: "0x6181D079FE60b44077E7a461d31519A53124FD54",
} as const;

// IGRA entry: tx id must start with the network prefix; mainnet also rides the
// KIP-21 lane (version 1, subnetwork = lane id zero-padded to 20 bytes).
export const IGRA_TX_ID_PREFIX = { mainnet: "97b1", testnet: "97b4" };
export const IGRA_MAINNET_LANE_ID = "97b10000";
export const IGRA_MIN_NET_KAS = { mainnet: 10, testnet: 1 };
export const IGRA_MAX_ENTRY_KAS = 5000;

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

type L1Ctx = { balance: number; networkFee: number; isMainnet: boolean };

function checkL1Funds(amount: number, { balance, networkFee }: L1Ctx) {
  if (amount > balance) return "Oh, you don't have enough funds";
  if (amount + networkFee > balance)
    return "Oh, you need KAS for the network fees";
  return undefined;
}

export function validateKasToIgra(amount: number, ctx: L1Ctx) {
  const minNet = IGRA_MIN_NET_KAS[ctx.isMainnet ? "mainnet" : "testnet"];
  if (amount - kastleL1BridgeFee(amount) < minNet) {
    return `Oh, please enter an amount above ${minGrossForNet(minNet)} KAS`;
  }
  if (amount > IGRA_MAX_ENTRY_KAS) {
    return `Oh, bridge supports entries up to ${IGRA_MAX_ENTRY_KAS} KAS`;
  }
  return checkL1Funds(amount, ctx);
}

export function validateKasToKasplex(amount: number, ctx: L1Ctx) {
  if (amount - kastleL1BridgeFee(amount) < 1) {
    return `Oh, minimum bridge amount is ${minGrossForNet(1)} KAS`;
  }
  return checkL1Funds(amount, ctx);
}

/**
 * IGRA entry payload, 33 bytes as hex:
 * [0x92][20B L2 address][8B amount sompi LE][4B nonce BE].
 */
export function igraEntryPayload(
  evmAddress: string,
  amountSompi: bigint,
  nonce = 0,
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(evmAddress)) {
    throw new Error("Invalid IGRA recipient address");
  }
  if (amountSompi <= 0n || amountSompi >= 1n << 64n) {
    throw new Error("Invalid IGRA entry amount");
  }
  const amountLe = Array.from({ length: 8 }, (_, i) =>
    ((amountSompi >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0"),
  ).join("");
  return (
    "92" +
    evmAddress.slice(2).toLowerCase() +
    amountLe +
    (nonce >>> 0).toString(16).padStart(8, "0")
  );
}
