import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";

const ANALYTICS_KEY = "local:analytics";

type Analytics = { hasFirstTransaction: boolean };

const defaultValues = {
  hasFirstTransaction: false,
};

export default function useAnalytics() {
  const { postHog } = useContext(PostHogWrapperContext);
  const [cachedAnalytics, setCachedAnalytics] = useState<Analytics>();

  return {
    emitOnboardingComplete: () => postHog?.capture("onboarding_complete"),
    emitFirstTransaction: async (properties: {
      direction: "send" | "receive";
      amount: string;
      coin: string;
    }) => {
      const analytics = cachedAnalytics
        ? cachedAnalytics
        : await storage.getItem<Analytics>(ANALYTICS_KEY, {
            fallback: defaultValues,
          });

      setCachedAnalytics(analytics);

      if (analytics.hasFirstTransaction) {
        return;
      }
      await storage.setItem(ANALYTICS_KEY, {
        ...analytics,
        hasFirstTransaction: true,
      });

      return postHog?.capture("first_transaction", properties);
    },
    emitWalletImported: () => postHog?.capture("wallet_imported"),
    emitPrivateKeyImported: () => postHog?.capture("key_imported"),
  };
}
