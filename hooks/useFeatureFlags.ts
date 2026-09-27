import { useContext, useEffect, useState } from "react";
import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";
import { isProduction } from "@/lib/utils.ts";

const SWAP_FLAG_KEY = "swap_enabled_extension";
const BRIDGE_FLAG_KEY = "bridge_enabled_extension";
// Extension-only (mobile uses `activity_v2_enabled`). Opt-in, unlike the kill switches above.
const ACTIVITY_FLAG_KEY = "activity_enabled_extension";

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
        // undefined = flags not fetched yet; a loaded map without the key = off.
        [ACTIVITY_FLAG_KEY]:
          postHog.getFeatureFlags()?.[ACTIVITY_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
      });

    updateFlags();
    return postHog.onFeatureFlags(updateFlags);
  }, [postHog]);

  return {
    isSwapEnabled: isFlagEnabled(flags[SWAP_FLAG_KEY]),
    isBridgeEnabled: isFlagEnabled(flags[BRIDGE_FLAG_KEY]),
    // Only an explicit `true` enables; dev builds force it on (mobile: __DEV__).
    isActivityEnabled: !isProduction || flags[ACTIVITY_FLAG_KEY] === true,
    // Deciding before PostHog's flags arrive would bounce a flagged-on user.
    // A PostHog that never fetches flags leaves this true forever (blank route).
    isActivityLoading: isProduction && flags[ACTIVITY_FLAG_KEY] === undefined,
  };
}
