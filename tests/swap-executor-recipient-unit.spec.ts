import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import {
  Address,
  Hex,
  PublicClient,
  WalletClient,
  decodeFunctionData,
} from "viem";
import type { SwapProvider } from "@/lib/evm/swap/constants";

// The swap constants import provider and chain logos; node cannot load an
// image, so stub them before the dynamic imports below pull the executor in.
registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const { createSwapExecutor } = await import("@/lib/evm/swap/swapExecutor");
const { FEE_COLLECTOR_SWAP_ABI, KASPA_COM_ROUTER_ABI, ZEALOUS_ROUTER_ABI } =
  await import("@/lib/evm/swap/utils");
const {
  KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER,
  KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER,
  KASPLEX_WKAS_ADDRESS,
} = await import("@/lib/evm/swap/constants");

const USER: Address = "0x00000000000000000000000000000000000000aa";
const TOKEN: Address = "0x00000000000000000000000000000000000000bb";
const LIVE_FEE_BPS = 30n;

// Stub clients: every contract has code, feeRate() answers LIVE_FEE_BPS, and
// the swap transaction is captured instead of sent.
async function swapKas(provider: SwapProvider) {
  const amountsIn: bigint[] = [];
  let sent: { to: Address; data: Hex } | undefined;
  const publicClient = {
    getCode: async () => "0x60",
    readContract: async ({
      functionName,
      args,
    }: {
      functionName: string;
      args: [bigint];
    }) => {
      if (functionName === "feeRate") return LIVE_FEE_BPS;
      amountsIn.push(args[0]);
      return [args[0], 1_000n];
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  const walletClient = {
    account: { address: USER },
    sendTransaction: async (tx: { to: Address; data: Hex }) => {
      sent = tx;
      return "0x01";
    },
  } as unknown as WalletClient;
  await createSwapExecutor(
    provider,
    publicClient,
    walletClient,
    KASPLEX_WKAS_ADDRESS,
  ).swapKASForTokens(10_000n, [KASPLEX_WKAS_ADDRESS, TOKEN]);
  return { sent: sent!, amountsIn };
}

// Swap args are (amountOutMin, path, to, deadline).
const recipient = (abi: readonly unknown[], data: Hex) =>
  String(decodeFunctionData({ abi, data } as never).args![2]).toLowerCase();

test("a direct router swap pays the user, never the router", async () => {
  const { sent } = await swapKas({
    ...KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER,
    feeCollectorAddress: undefined,
  });
  expect(recipient(ZEALOUS_ROUTER_ABI, sent.data)).toBe(USER);
});

test("a fee-collector swap pays the user and quotes on the live feeRate", async () => {
  const { sent, amountsIn } = await swapKas(
    KASPLEX_MAINNET_ZEALOUS_SWAP_PROVIDER,
  );
  expect(recipient(FEE_COLLECTOR_SWAP_ABI, sent.data)).toBe(USER);
  expect(String(amountsIn[0])).toBe("9970");
});

test("a KaspaCom swap names its proxy, which forwards to the user", async () => {
  const { sent } = await swapKas(KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER);
  const proxy = KASPLEX_MAINNET_KASPA_COM_SWAP_PROVIDER.proxyAddress!;
  expect(sent.to.toLowerCase()).toBe(proxy.toLowerCase());
  expect(recipient(KASPA_COM_ROUTER_ABI, sent.data)).toBe(proxy.toLowerCase());
});
