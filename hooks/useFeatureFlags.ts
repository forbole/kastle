import { useContext, useEffect, useState } from "react";
import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";

const SWAP_FLAG_KEY = "swap_enabled_extension";
const BRIDGE_FLAG_KEY = "bridge_enabled_extension";

type FlagValue = string | boolean | undefined;

/**
 * Kill switch: only an explicit `false` (boolean or string, any case) disables.
 * undefined (PostHog unloaded/unreachable, or the flag inactive — /decide v3
 * omits inactive flags) means enabled, so to switch a feature off keep the
 * flag active and roll it out to 0%.
 */
export function isFlagEnabled(value: FlagValue): boolean {
  if (typeof value === "string") return value.toLowerCase() !== "false";
  return value !== false;
}

export function useFeatureFlags() {
  const { postHog } = useContext(PostHogWrapperContext);
  const [flags, setFlags] = useState<Record<string, FlagValue>>({});

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
    isSwapEnabled: isFlagEnabled(flags[SWAP_FLAG_KEY]),
    isBridgeEnabled: isFlagEnabled(flags[BRIDGE_FLAG_KEY]),
  };
}
