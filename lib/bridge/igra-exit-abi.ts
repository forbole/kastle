// KasBridge.sol ABI — KAT custodial KAS ↔ iKAS bridge on Igra
export const IGRA_EXIT_BRIDGE_ABI = [
  {
    inputs: [{ internalType: "bytes", name: "kaspaAddress", type: "bytes" }],
    name: "lockForExit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "grossAmount", type: "uint256" }],
    name: "getCurrentFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "maxExitAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MIN_FEE_FLOOR",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "MIN_EXIT_AMOUNT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rollingExitCap",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "rollingExitTotal",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "availableReserves",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pendingExitNet",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "isWithinExitCap",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "bridgeDisabled",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feePercentBps",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "exitId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "grossAmount",
        type: "uint256",
      },
      { indexed: false, internalType: "uint256", name: "fee", type: "uint256" },
      {
        indexed: false,
        internalType: "uint256",
        name: "netAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "kaspaAddress",
        type: "bytes",
      },
    ],
    name: "LockForExit",
    type: "event",
  },
] as const;

// Canonical KAT custodial KasBridge on Igra mainnet, confirmed by KAT 2026-08-11
// (lockForExit / claimRefund / availableReserves / pendingExitNet / proposeForceRefundExit).
// Do NOT use 0x4bb88C213d3eD9dc4bae694f1bc1bF745903b2d0 — that is Igra's permissionless
// KasExitBridge (UUPS proxy, getConfig/requestExit/throttle ABI), a different product;
// KasBridge views revert on it.
// Kaspa L1 vault that holds/releases KAS for Igra exits (payout source).
export const IGRA_KAS_VAULT_MAINNET =
  "kaspa:qrdlxhjlzmftuvdwclk743vkh8a5xeantuwunl9xg7c4mdjtdk6n768qqx48c";

export const IGRA_EXIT_BRIDGE_MAINNET =
  "0xb82c5524c5b5c055efb2F8f4AbCcE3173c504f2d";

// Testnet contract address — update when available
export const IGRA_EXIT_BRIDGE_TESTNET =
  "0x0000000000000000000000000000000000000000";
