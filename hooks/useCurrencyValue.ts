import useSWR from "swr";
import { fetcher } from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings.ts";

type ExchangeRatesResponse = {
  success: boolean;
  terms: string;
  privacy: string;
  timestamp: number;
  source: string;
  quotes: Record<string, number>;
};

export default function useCurrencyValue(usdAmount: number) {
  const [settings] = useSettings();
  const currency = settings?.currency ?? "USD";

  const exchangeRatesResponse = useSWR<ExchangeRatesResponse>(
    "https://exchangerates.forbole.com/currency-api/",
    fetcher,
    { refreshInterval: 1800000 }, // 30 min
  );

  if (currency === "USD") {
    return { amount: usdAmount, code: "USD" };
  }

  const rate = exchangeRatesResponse.data?.quotes?.[`USD${currency}`] ?? 1;

  return { amount: usdAmount * rate, code: currency };
}
