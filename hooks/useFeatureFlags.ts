import { useContext, useEffect, useState } from "react";
import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";
import { isProduction } from "@/lib/utils.ts";
import {
  migrationLocalOptIn,
  migrationLocalPayload,
  standardLocalOptIn,
} from "@/lib/kcc20/local-opt-in";
import {
  MigrationFlagCache,
  readMigrationFlagCache,
  writeMigrationFlagCache,
} from "@/lib/kcc20/migration-flag-cache";
import { kassealLocalOptIn } from "@/lib/kasseal/local-opt-in";

const SWAP_FLAG_KEY = "swap_enabled_extension";
const BRIDGE_FLAG_KEY = "bridge_enabled_extension";
const KCC20_FLAG_KEY = "kcc20_enabled_extension";
// Opt-in, dev builds included: KCC-20 standard rows read kascov, a third party.
const KCC20_STANDARD_FLAG_KEY = "kcc20_standard_enabled";
// Extension-only (mobile uses `activity_v2_enabled`). Opt-in, unlike the kill switches above.
const ACTIVITY_FLAG_KEY = "activity_enabled_extension";
// Kill switch like swap/bridge: switch off with active + 0% rollout, never "inactive".
const DOTK_FLAG_KEY = "dotk_enabled_extension";
// Covenant spends against a third-party launchpad: default off in every build,
// like the KCC-20 standard rows. No UI reads it yet: the launchpad screens were
// removed, and Kasseal assets will come into the Swap UI later.
const KASSEAL_FLAG_KEY = "kasseal_enabled_extension";
// KRC-20 → KCC-20 migration route in Bridge (shared with mobile). Opt-in in
// every build; the last delivered value is cached in browser.storage.local
// under `feature_flag_kcc20_migration_route`. Dev builds: VITE_KCC20_MIGRATION.
const MIGRATION_ROUTE_FLAG_KEY = "kcc20_migration_route";
// Shared with mobile. Its payload `{ url, tokens: { tick, covenantId }[] }`
// names the tool and the migratable ticks; read only while the flag is `true`,
// cached under `feature_flag_kcc20_migration`, parsed by lib/kcc20/migration.
const MIGRATION_FLAG_KEY = "kcc20_migration";
// PostHog can fail to init (context stays undefined) or never deliver flags;
// neither is distinguishable from "still loading", so the wait is bounded.
const FLAGS_TIMEOUT_MS = 5_000;

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
  const [flagsTimedOut, setFlagsTimedOut] = useState(false);
  const [migrationPayload, setMigrationPayload] = useState<unknown>();
  const [migrationCache, setMigrationCache] = useState<MigrationFlagCache>();

  useEffect(() => {
    if (!isProduction) return;
    const timer = setTimeout(() => setFlagsTimedOut(true), FLAGS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!postHog) return;

    const updateFlags = () => {
      setFlags({
        [SWAP_FLAG_KEY]: postHog.getFeatureFlags()?.[SWAP_FLAG_KEY],
        [BRIDGE_FLAG_KEY]: postHog.getFeatureFlags()?.[BRIDGE_FLAG_KEY],
        [DOTK_FLAG_KEY]: postHog.getFeatureFlags()?.[DOTK_FLAG_KEY],
        // undefined = flags not fetched yet; a loaded map without the key = off.
        [KCC20_FLAG_KEY]:
          postHog.getFeatureFlags()?.[KCC20_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
        [KCC20_STANDARD_FLAG_KEY]:
          postHog.getFeatureFlags()?.[KCC20_STANDARD_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
        [ACTIVITY_FLAG_KEY]:
          postHog.getFeatureFlags()?.[ACTIVITY_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
        [KASSEAL_FLAG_KEY]:
          postHog.getFeatureFlags()?.[KASSEAL_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
        [MIGRATION_ROUTE_FLAG_KEY]:
          postHog.getFeatureFlags()?.[MIGRATION_ROUTE_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
        [MIGRATION_FLAG_KEY]:
          postHog.getFeatureFlags()?.[MIGRATION_FLAG_KEY] ??
          (postHog.getFeatureFlags() ? false : undefined),
      });
      setMigrationPayload(
        postHog.getFeatureFlagPayloads?.()?.[MIGRATION_FLAG_KEY],
      );
    };

    updateFlags();
    return postHog.onFeatureFlags(updateFlags);
  }, [postHog]);

  useEffect(() => {
    readMigrationFlagCache()
      .then(setMigrationCache)
      .catch(() => {});
  }, []);

  const liveMigrationRoute = flags[MIGRATION_ROUTE_FLAG_KEY];
  const liveMigration = flags[MIGRATION_FLAG_KEY];
  const liveMigrationPayload =
    liveMigration === true ? migrationPayload : undefined;
  // Keyed on content, so a fresh payload object per delivery doesn't rewrite.
  const liveMigrationPayloadKey = JSON.stringify(liveMigrationPayload ?? null);
  useEffect(() => {
    if (liveMigrationRoute === undefined || liveMigration === undefined) return;
    void writeMigrationFlagCache({
      route: liveMigrationRoute === true,
      payload: liveMigrationPayload,
    }).catch(() => {});
  }, [liveMigrationRoute, liveMigration, liveMigrationPayloadKey]);
  // live flag > cache > off; local builds can opt in without PostHog.
  const migrationOptIn = !isProduction && migrationLocalOptIn();
  const kcc20MigrationPayload =
    (liveMigration !== undefined
      ? liveMigrationPayload
      : migrationCache?.payload) ??
    (migrationOptIn ? migrationLocalPayload() : undefined);

  return {
    isSwapEnabled: isFlagEnabled(flags[SWAP_FLAG_KEY]),
    isBridgeEnabled: isFlagEnabled(flags[BRIDGE_FLAG_KEY]),
    isDotkEnabled: isFlagEnabled(flags[DOTK_FLAG_KEY]),
    // Covenant spends fail closed: only an explicit `true` enables in production.
    isKcc20Enabled: !isProduction || flags[KCC20_FLAG_KEY] === true,
    // Same bounded wait as Activity: after FLAGS_TIMEOUT_MS KCC-20 fails closed.
    isKcc20Loading:
      isProduction && flags[KCC20_FLAG_KEY] === undefined && !flagsTimedOut,
    // Default off: only an explicit `true` enables, in every build.
    isKcc20StandardEnabled:
      flags[KCC20_STANDARD_FLAG_KEY] === true ||
      // Local builds can opt in without touching the PostHog flag.
      (!isProduction && standardLocalOptIn()),
    // Only an explicit `true` enables; dev builds force it on (mobile: __DEV__).
    isActivityEnabled: !isProduction || flags[ACTIVITY_FLAG_KEY] === true,
    // Deciding before PostHog's flags arrive would bounce a flagged-on user,
    // but only for FLAGS_TIMEOUT_MS: after that Activity fails closed (off).
    isActivityLoading:
      isProduction && flags[ACTIVITY_FLAG_KEY] === undefined && !flagsTimedOut,
    // Only an explicit `true` enables, in every build; local builds can opt in.
    isKassealEnabled:
      flags[KASSEAL_FLAG_KEY] === true ||
      (!isProduction && kassealLocalOptIn()),
    // Same bounded wait as KCC-20.
    isKassealLoading:
      isProduction && flags[KASSEAL_FLAG_KEY] === undefined && !flagsTimedOut,
    // Only an explicit `true` enables, in every build.
    isKcc20MigrationRouteEnabled:
      (liveMigrationRoute !== undefined
        ? liveMigrationRoute === true
        : (migrationCache?.route ?? false)) || migrationOptIn,
    // Raw `kcc20_migration` payload; parse with parseMigrationPayload.
    kcc20MigrationPayload,
  };
}
