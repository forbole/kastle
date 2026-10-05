import { expect, test } from "@playwright/test";
import { SWAP_GAS_ESTIMATES } from "@/hooks/evm/useFeeEstimateByGas";

// Swap.tsx picks UNWRAP for unwrap and WRAP for wrap; they must stay distinct.
test("unwrap gas estimate exceeds wrap gas estimate", () => {
  expect(SWAP_GAS_ESTIMATES.UNWRAP > SWAP_GAS_ESTIMATES.WRAP).toBe(true);
});
