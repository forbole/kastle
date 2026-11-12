import { useContext, useEffect, useMemo, useState } from "react";
import { PostHogWrapperContext } from "@/contexts/PostHogWrapperProvider.tsx";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import {
  migratableHeld,
  parseMigrationPayload,
  type Kcc20MigrationConfig,
} from "@/lib/kcc20/migration";

const MIGRATION_FLAG_KEY = "kcc20_migration";

/**
 * KRC-20 → KCC-20 migration, driven by the PostHog flags shared with mobile:
 * `kcc20_migration` (on + payload `{ url, tokens }`) and
 * `kcc20_migration_route` (the entry points). Both are opt-in: anything but
 * an explicit true, including flags not loaded yet, keeps it off.
 *
 * `migratableHeld` is the wallet's payload-listed KRC-20 holdings, mainnet
 * only, so every entry point (Bridge row today, more later) agrees on it. No
 * tokenlist request is made while the migration is inactive.
 */
export function useKcc20Migration({
  address,
  isMainnet,
}: {
  address?: string;
  isMainnet: boolean;
}) {
  const { postHog } = useContext(PostHogWrapperContext);
  const { kcc20MigrationRoute } = useFeatureFlags();
  const [raw, setRaw] = useState<{ flag: unknown; payload: unknown }>({
    flag: undefined,
    payload: undefined,
  });

  useEffect(() => {
    if (!postHog) return;
    const update = () =>
      setRaw({
        flag: postHog.getFeatureFlags()?.[MIGRATION_FLAG_KEY],
        payload: postHog.getFeatureFlagPayload(MIGRATION_FLAG_KEY),
      });
    update();
    return postHog.onFeatureFlags(update);
  }, [postHog]);

  // Keyed on content, not identity: a fresh payload object must not re-parse.
  const payloadKey = JSON.stringify(raw.payload ?? null);
  const config: Kcc20MigrationConfig | undefined = useMemo(
    () => (raw.flag === true ? parseMigrationPayload(raw.payload) : undefined),
    [raw.flag, payloadKey],
  );

  const enabled = config !== undefined;
  const active = enabled && kcc20MigrationRoute && isMainnet;
  const tokenList = useTokenListByAddress(active ? address : undefined);

  const held = useMemo(
    () => (active ? migratableHeld(config, tokenList ?? []) : []),
    [active, config, tokenList],
  );

  return { enabled: active, config, migratableHeld: held };
}
