import { usePostHog } from "posthog-js/react";

const ANALYTICS_KEY = "local:analytics";

type Analytics = { hasFirstTransaction: boolean };

export default function useAnalytics() {
  const postHog = usePostHog();

  return {
    emitOnboardingComplete: () => postHog.capture("onboarding_complete"),
    emitFirstTransaction: async (properties: {
      direction: "send" | "receive";
      amount: string;
      coin: "KAS";
    }) => {
      const analytics = await storage.getItem<Analytics>(ANALYTICS_KEY, {
        fallback: {
          hasFirstTransaction: false,
        },
      });

      if (analytics.hasFirstTransaction) {
        return;
      }
      await storage.setItem(ANALYTICS_KEY, {
        ...analytics,
        hasFirstTransaction: true,
      });

      return postHog.capture("first_transaction", properties);
    },
    emitWalletImported: () => postHog.capture("wallet_imported"),
    emitPrivateKeyImported: () => postHog.capture("key_imported"),
  };
}
