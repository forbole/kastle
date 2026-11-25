import { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { BaseError } from "viem";
import { kasplexTestnet } from "@/lib/layer2";

declare global {
  interface Window {
    __erc20: { captured: string[]; sent: number };
  }
}

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
export const TOKEN = "0x00000000000000000000000000000000000000cc" as const;
const asset = {
  address: TOKEN,
  symbol: "TKN",
  decimals: 18,
  chainId: `0x${kasplexTestnet.id.toString(16)}` as `0x${string}`,
};

export const captureException = (e: unknown) => {
  window.__erc20.captured.push(String(e).split("\n")[0]);
};

export const useWalletManager = () => ({ wallet: { type: "hot" } });
export const useEvmHotWalletSigner = () => ({ getAddress: async () => OWNER });
export const useErc20Info = () => asset;
export const useEvmAddress = () => OWNER;
export const useFeeEstimate = () => ({ data: undefined });
export const useKaspaPrice = () => ({ kaspaPrice: 0 });
export const useCurrencyValue = () => ({ amount: 0, code: "USD" });
export const useAnalytics = () => ({
  emitSendCompleted: () => {},
  emitFirstTransaction: async () => {},
});
export const useInsRecipientCheck = () => ({
  check: undefined,
  verify: async () => true,
});
export const useErc20Price = () => ({ price: 0 });

// Fills what the real details step would and moves on to Confirm.
export function DetailsStep({ onNext }: { onNext: () => void }) {
  const { setValue } = useFormContext();
  useEffect(() => {
    setValue("address", "0x000000000000000000000000000000000000dEaD");
    setValue("amount", "1.5");
    onNext();
  }, []);
  return null;
}

// Reached only if estimateGas resolves. ?send=hostile: the broadcast throws an
// error whose `.cause` getter throws, so its report cannot be built.
export const sendEvmTransaction = async () => {
  window.__erc20.sent++;
  const mode = new URLSearchParams(location.search).get("send");
  // hostile-viem: the same, as a viem BaseError, so walking it for the RPC
  // code reads the throwing `.cause` before the report is built.
  if (mode === "hostile" || mode === "hostile-viem") {
    const error =
      mode === "hostile"
        ? new Error("node went away")
        : new BaseError("node went away");
    Object.defineProperty(error, "cause", {
      get() {
        throw new Error("hostile cause");
      },
    });
    throw error;
  }
  return "0xtx";
};

export const browser = {
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
};

export const formatUsdAmount = (amount: number) => `$${amount}`;
export const formatToken = (amount: number) => String(amount);
