import { createContext, ReactNode, useState } from "react";

const COINGECKO_API_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd";

const KASPA_PRICE_KEY = "local:kaspa_price_key" as const;

const INTERVAL = 30000;

type KaspaPriceData = {
  price: number;
  lastSync: number | undefined;
};

interface KaspaPriceContextType {
  kaspaPrice: number;
}

export const KaspaPriceContext = createContext<KaspaPriceContextType>({
  kaspaPrice: 0,
});

export function KaspaPriceProvider({ children }: { children: ReactNode }) {
  const [kaspaPrice, setKaspaPrice] = useState(0);

  const getSavedKaspaPriceData = () =>
    storage.getItem<KaspaPriceData>(KASPA_PRICE_KEY, {
      fallback: { price: 0, lastSync: undefined },
    });

  const getSavedPrice = async () => {
    const { price } = await getSavedKaspaPriceData();

    setKaspaPrice(price);
  };

  const fetchKaspaPrice = async () => {
    const { lastSync } = await getSavedKaspaPriceData();

    // Guard against premature fetches
    if (lastSync && lastSync + INTERVAL > Date.now()) {
      return;
    }

    try {
      const response = await fetch(COINGECKO_API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data: {
        kaspa: {
          usd: number;
        };
      } = await response.json();
      const price = data.kaspa.usd;

      await storage.setItem<KaspaPriceData>(KASPA_PRICE_KEY, {
        price: price,
        lastSync: Date.now(),
      });
      setKaspaPrice(price);
    } catch (err) {
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
    <KaspaPriceContext.Provider value={{ kaspaPrice }}>
      {children}
    </KaspaPriceContext.Provider>
  );
}
