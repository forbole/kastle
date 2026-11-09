import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import { getUsdRates } from "@/lib/cache/usdRatesCache.ts";

export default function useCurrencyValue(usdAmount: number) {
  const [settings] = useSettings();
  const currency = settings?.currency ?? "USD";

  const { data: rates } = useSWR("usd-rates", () => getUsdRates(), {
    refreshInterval: 600000, // 10 min, the cache TTL
  });

  // Without a rate, show the USD amount as USD, never under another code.
  const rate = rates?.[currency.toLowerCase()];
  if (currency === "USD" || !rate) {
    return { amount: usdAmount, code: "USD" as const };
  }

  return { amount: usdAmount * rate, code: currency };
}
