import { createContext, ReactNode, useState } from "react";
import { captureException } from "@sentry/react";

const COINGECKO_API_URL =
  "https://api.coingecko.com/api/v3/coins/kaspa/market_chart?vs_currency=usd&days=2&interval=daily";

const KASPA_PRICE_KEY = "local:kaspa_price_key" as const;

const INTERVAL = 30000;

type KaspaPriceData = {
  price: number;
  lastDayPrice: number | undefined;
  lastSync: number | undefined;
};

interface KaspaPriceContextType {
  kaspaPrice: number;
  lastDayKaspaPrice: number;
}

export const KaspaPriceContext = createContext<KaspaPriceContextType>({
  kaspaPrice: 0,
  lastDayKaspaPrice: 0,
});

export function KaspaPriceProvider({ children }: { children: ReactNode }) {
  const [kaspaPrice, setKaspaPrice] = useState(0);
  const [lastDayKaspaPrice, setLastDayKaspaPrice] = useState(0);

  const getSavedKaspaPriceData = () =>
    storage.getItem<KaspaPriceData>(KASPA_PRICE_KEY, {
      fallback: { price: 0, lastDayPrice: undefined, lastSync: undefined },
    });

  const getSavedPrice = async () => {
    const { price, lastDayPrice } = await getSavedKaspaPriceData();

    setKaspaPrice(price);
    setLastDayKaspaPrice(lastDayPrice ?? 0);
  };

  const fetchKaspaPrice = async () => {
    const { lastSync, lastDayPrice } = await getSavedKaspaPriceData();

    // Guard against premature fetches
    if (lastSync && lastSync + INTERVAL > Date.now() && lastDayPrice !== undefined) {
    }

    try {
      const response = await fetch(COINGECKO_API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // [priceLast2Day, priceLast1Day, priceCurrent]
      // LastDayPrice is the price from 24h ~ 48h ago
      // This is because the coingecko only record the price at the end of the day
      const data: {
        prices: [[number, number], [number, number], [number, number]]; // [timestamp, price][3]
      } = await response.json();
      const lastDayPrice = data.prices[0][1];
      const price = data.prices[2][1];

      await storage.setItem<KaspaPriceData>(KASPA_PRICE_KEY, {
        price: price,
        lastDayPrice: lastDayPrice,
        lastSync: Date.now(),
      });
      setLastDayKaspaPrice(lastDayPrice);
      setKaspaPrice(price);
    } catch (err) {
      captureException(err);
      console.error("Error fetching Kaspa price:", err);
    }
  };

  useEffect(() => {
    // From storage
    getSavedPrice();

    // Initial fetch
    fetchKaspaPrice();

    // Setup interval for repeated fetching
    const intervalId = setInterval(fetchKaspaPrice, INTERVAL);

    // Cleanup function to clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []);

  return (
    <KaspaPriceContext.Provider value={{ kaspaPrice, lastDayKaspaPrice }}>
      {children}
    </KaspaPriceContext.Provider>
  );
}
