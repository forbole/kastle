import { useContext, useEffect, useState } from "react";
import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";

const SWAP_FLAG_KEY = "swap_enabled_extension";
const BRIDGE_FLAG_KEY = "bridge_enabled_extension";

/** Kill switches: undefined (PostHog unloaded/unreachable/key absent) means enabled — only an explicit `false` disables. */
export function useFeatureFlags() {
  const { postHog } = useContext(PostHogWrapperContext);
  const [flags, setFlags] = useState<Record<string, string | boolean | undefined>>({});

  useEffect(() => {
    if (!postHog) return;

    const updateFlags = () =>
      setFlags({
        [SWAP_FLAG_KEY]: postHog.getFeatureFlags()?.[SWAP_FLAG_KEY],
        [BRIDGE_FLAG_KEY]: postHog.getFeatureFlags()?.[BRIDGE_FLAG_KEY],
      });

    updateFlags();
    return postHog.onFeatureFlags(updateFlags);
  }, [postHog]);

  return {
    isSwapEnabled: flags[SWAP_FLAG_KEY] !== false,
    isBridgeEnabled: flags[BRIDGE_FLAG_KEY] !== false,
  };
}
