import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";
import { hashAddress } from "@/lib/utils";

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

type CommonSendCompleted = { sender?: string };
type FungibleSendCompleted = CommonSendCompleted & {
  value_native?: number;
  native_asset?: string;
  value_usd?: number;
};

export type SendCompletedProperties =
  | ({
      type: "KAS";
      id: "KAS";
      status: "success" | "failed";
    } & FungibleSendCompleted)
  | ({
      type: "KRC20";
      id: string;
      status: "success" | "failed";
    } & FungibleSendCompleted)
  | ({
      type: "EVM_KAS";
      id: string;
      chainId: number;
      status: "success" | "failed";
    } & FungibleSendCompleted)
  | ({
      type: "ERC20";
      id: string;
      chainId: number;
      status: "success" | "failed";
    } & FungibleSendCompleted)
  | ({
      type: "KRC721";
      id: string;
      status: "success" | "failed";
    } & CommonSendCompleted)
  | ({
      type: "KNS";
      id: string;
      status: "success" | "failed";
    } & CommonSendCompleted)
  | ({
      type: "ERC721";
      id: string;
      chainId: number;
      status: "success" | "failed";
    } & CommonSendCompleted);

export default function useAnalytics() {
  const { postHog } = useContext(PostHogWrapperContext);
  const [cachedAnalytics, setCachedAnalytics] = useState<Analytics>();

  const captureWithSender = (
    event: string,
    properties: Record<string, unknown>,
  ) => {
    const { sender, ...rest } = properties;
    const senderStr = typeof sender === "string" ? sender : undefined;
    if (senderStr) {
      void hashAddress(senderStr)
        .then((hashedSender) =>
          postHog?.capture(event, { ...rest, hashedSender }),
        )
        .catch(() => postHog?.capture(event, rest));
    } else {
      postHog?.capture(event, rest);
    }
  };

  return {
    emitOnboardingCompleted: () => postHog?.capture("onboarding_completed"),
    emitWalletCreated: (properties: {
      method: "new" | "import";
      sender?: string;
    }) => captureWithSender("wallet_created", properties),
    emitAccountCreated: (properties: { sender?: string }) =>
      captureWithSender("account_created", properties),
    emitSendInitiated: (properties: SendInitiatedProperties) =>
      postHog?.capture("send_initiated", properties),
    emitSendCompleted: (properties: SendCompletedProperties) =>
      captureWithSender(
        "send_completed",
        properties as Record<string, unknown>,
      ),
    emitKasSignTx: (properties: {
      origin: string;
      status: "success" | "failed";
    }) => postHog?.capture("kas:sign_tx", properties),
    emitKasSignAndBroadcastTx: (properties: {
      origin: string;
      status: "success" | "failed";
    }) => postHog?.capture("kas:sign_and_broadcast_tx", properties),
    emitEthSendTransaction: (properties: {
      origin: string;
      status: "success" | "failed";
    }) => postHog?.capture("eth_sendTransaction", properties),
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
