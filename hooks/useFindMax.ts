import { useCallback } from "react";
import { truncToDecimals } from "@/lib/utils";

export type FindMaxMode = "token" | "usd";

export interface UseFindMaxOptions {
  balance: number;
  price?: number;
  subtrahend?: number;
  minSubtrahend?: number;
}

export function useFindMax(options: UseFindMaxOptions) {
  const { balance, price, subtrahend = 0, minSubtrahend = 0 } = options;

  return useCallback(
    (mode: FindMaxMode = "token"): string => {
      if (!balance || balance <= 0) return "0";

      const maxAmount = Math.max(
        0,
        balance - Math.max(subtrahend, minSubtrahend),
      );

      if (mode === "usd") {
        if (!price || price <= 0) return "0";
        return truncToDecimals(maxAmount * price, 8).toString();
      }

      return truncToDecimals(maxAmount, 8).toString();
    },
    [balance, price, subtrahend, minSubtrahend],
  );
}
