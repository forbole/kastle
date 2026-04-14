import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";

const ANALYTICS_KEY = "local:analytics";

type Analytics = { hasFirstTransaction: boolean };

const defaultValues = {
  hasFirstTransaction: false,
};

export type SendInitiatedProperties =
  | { type: "KAS"; id: "KAS" }
  | { type: "KRC20"; id: string }
  | { type: "EVM_KAS"; id: string; chainId: number }
  | { type: "ERC20"; id: string; chainId: number };

export type SendCompletedProperties =
  | { type: "KAS"; id: "KAS"; status: "success" | "failed" }
  | { type: "KRC20"; id: string; status: "success" | "failed" }
  | {
      type: "EVM_KAS";
      id: string;
      chainId: number;
      status: "success" | "failed";
    }
  | {
      type: "ERC20";
      id: string;
      chainId: number;
      status: "success" | "failed";
    }
  | { type: "KRC721"; id: string; status: "success" | "failed" }
  | { type: "KNS"; id: string; status: "success" | "failed" }
  | {
      type: "ERC721";
      id: string;
      chainId: number;
      status: "success" | "failed";
    };

export default function useAnalytics() {
  const { postHog } = useContext(PostHogWrapperContext);
  const [cachedAnalytics, setCachedAnalytics] = useState<Analytics>();

  return {
    emitOnboardingCompleted: () => postHog?.capture("onboarding_completed"),
    emitWalletCreated: (properties: { method: "new" | "import" }) =>
      postHog?.capture("wallet_created", properties),
    emitSendInitiated: (properties: SendInitiatedProperties) =>
      postHog?.capture("send_initiated", properties),
    emitSendCompleted: (properties: SendCompletedProperties) =>
      postHog?.capture("send_completed", properties),
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
  };
}
