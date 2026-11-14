import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";

type MigrationModule = typeof import("../lib/kcc20/migration");
type HookModule = typeof import("../hooks/useKcc20Migration");
type FeatureFlagsModule = typeof import("../hooks/useFeatureFlags");
type Flags = Record<string, unknown> | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Transpiles a source file to CommonJS and evaluates it with `stubs` as its imports. */
function load<T>(file: string, stubs: Record<string, unknown> = {}): T {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} as T };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`unstubbed import ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const migration = load<MigrationModule>("lib/kcc20/migration.ts");

const NACHO_COV = "a".repeat(64);
const PAYLOAD = {
  url: "https://katbridge.com/migrate",
  tokens: [{ tick: "nacho", covenantId: NACHO_COV }],
};
const ON = {
  kcc20_migration: true,
  kcc20_migration_route: true,
};
const ADDRESS = "kaspa:qtest";

/**
 * Renders useKcc20Migration twice (the first pass's effects fill state)
 * against a PostHog stub carrying `flags` and `payload`. The hook's
 * useFeatureFlags is the real source, sharing the same
 * React stub and PostHog context, so the `kcc20_migration_route` gate under
 * test is the shipped one. The tokenlist stub records the address it was
 * asked for, so "no request while inactive" is observable.
 */
function renderMigration({
  flags,
  payload,
  held = [],
  isMainnet = true,
  noAddress = false,
}: {
  flags: Flags;
  payload?: unknown;
  held?: { id: string; balance: string; dec: string }[];
  isMainnet?: boolean;
  noAddress?: boolean;
}) {
  const requested: (string | undefined)[] = [];
  const requestOptions: unknown[] = [];
  const slots: unknown[] = [];
  let slot = 0;
  const postHog = {
    getFeatureFlags: () => flags,
    getFeatureFlagPayload: (key: string) =>
      key === "kcc20_migration" ? payload : undefined,
    onFeatureFlags: () => () => {},
  };
  const react = {
    useContext: () => ({ postHog }),
    useState: (initial: unknown) => {
      const i = slot++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: unknown) => (slots[i] = next)];
    },
    useEffect: (effect: () => void) => effect(),
    useMemo: (fn: () => unknown) => fn(),
  };
  const featureFlags = load<FeatureFlagsModule>("hooks/useFeatureFlags.ts", {
    react,
    "@/contexts/PostHogWrapperProvider.tsx": { PostHogWrapperContext: {} },
    // The route gate has no dev override; a dev build skips the 5 s timer.
    "@/lib/utils.ts": { isProduction: false },
    "@/lib/kcc20/local-opt-in": { standardLocalOptIn: () => false },
    "@/lib/kasseal/local-opt-in": { kassealLocalOptIn: () => false },
  });
  const run = load<HookModule>("hooks/useKcc20Migration.ts", {
    react,
    "@/contexts/PostHogWrapperProvider.tsx": { PostHogWrapperContext: {} },
    "@/hooks/useFeatureFlags": featureFlags,
    "@/hooks/kasplex/useTokenListByAddress": {
      useTokenListByAddress: (
        address?: string,
        _refreshInterval?: number,
        options?: unknown,
      ) => {
        requested.push(address);
        requestOptions.push(options);
        return address ? held : undefined;
      },
    },
    "@/lib/kcc20/migration": migration,
  }).useKcc20Migration;
  const render = () => {
    slot = 0;
    return run({ address: noAddress ? undefined : ADDRESS, isMainnet });
  };
  render(); // effects fill state
  requested.length = 0;
  requestOptions.length = 0;
  const result = render();
  return { ...result, requested, requestOptions };
}

// The predicate Bridge.tsx renders the row with, not a copy of it.
const shown = (r: ReturnType<typeof renderMigration>) =>
  migration.migrationRowUrl(r);

test.describe("Bridge migrate row (useKcc20Migration)", () => {
  test("no migratable token held: still shown (the guide needs no holding)", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [
        { id: "KASPY", balance: "500", dec: "8" },
        { id: "NACHO", balance: "0", dec: "8" },
      ],
    });
    expect(shown(r)).toBe("https://katbridge.com/migrate");
    expect(r.migratableHeld).toEqual([]);
    expect(r.requested).toEqual([ADDRESS]);
  });

  test("enabled without config, or disabled: hidden", () => {
    expect(migration.migrationRowUrl({ enabled: true })).toBeUndefined();
    expect(
      migration.migrationRowUrl({
        enabled: false,
        config: { url: "https://katbridge.com/migrate", tokens: [] },
      }),
    ).toBeUndefined();
  });

  test("NACHO held: shown, opening the payload url", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [
        { id: "NACHO", balance: "100000000", dec: "8" },
        { id: "KASPY", balance: "500", dec: "8" },
      ],
    });
    expect(shown(r)).toBe("https://katbridge.com/migrate");
    expect(r.migratableHeld.map((t) => t.id)).toEqual(["NACHO"]);
  });

  test("flag off, missing or not loaded: hidden and no tokenlist request", () => {
    const held = [{ id: "NACHO", balance: "1", dec: "8" }];
    for (const flags of [
      { kcc20_migration: true, kcc20_migration_route: false },
      { kcc20_migration: true, kcc20_migration_route: "true" },
      { kcc20_migration: false, kcc20_migration_route: true },
      { kcc20_migration: "true", kcc20_migration_route: true },
      { kcc20_migration: true },
      {},
      undefined,
    ]) {
      const r = renderMigration({ flags, payload: PAYLOAD, held });
      expect(shown(r)).toBeFalsy();
      expect(r.requested).toEqual([undefined]);
    }
  });

  test("requests the current address's list with previous-key data off", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [{ id: "NACHO", balance: "1", dec: "8" }],
    });
    expect(r.requested).toEqual([ADDRESS]);
    // keepPreviousData would hand back the last account's holdings after a
    // switch; eligibility must come from this address's list only.
    expect(r.requestOptions).toEqual([{ keepPreviousData: false }]);
  });

  test("no address: hidden and no tokenlist request", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [{ id: "NACHO", balance: "1", dec: "8" }],
      noAddress: true,
    });
    // Eligibility itself clears, not just the list: under real SWR a null key
    // with keepPreviousData would still return the last account's holdings.
    expect(r.enabled).toBe(false);
    expect(shown(r)).toBeFalsy();
    expect(r.migratableHeld).toEqual([]);
    expect(r.requested).toEqual([undefined]);
  });

  test("testnet: hidden and no tokenlist request", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [{ id: "NACHO", balance: "1", dec: "8" }],
      isMainnet: false,
    });
    expect(shown(r)).toBeFalsy();
    expect(r.requested).toEqual([undefined]);
  });

  test("bad payload (non-https url, unlisted host, no url): hidden", () => {
    const held = [{ id: "NACHO", balance: "1", dec: "8" }];
    for (const url of [
      "http://katbridge.com/migrate",
      "https://katbridge.com.evil.io/migrate",
      "javascript:alert(1)",
      "https://user:pass@katbridge.com/migrate",
      undefined,
    ]) {
      const r = renderMigration({
        flags: ON,
        payload: { ...PAYLOAD, url },
        held,
      });
      expect(r.config).toBeUndefined();
      expect(shown(r)).toBeFalsy();
    }
  });

  test("bad payload (non-hex covenant): token dropped, nothing migratable, row still shown", () => {
    const r = renderMigration({
      flags: ON,
      payload: {
        ...PAYLOAD,
        tokens: [
          { tick: "NACHO", covenantId: "z".repeat(64) },
          { tick: "NACHO", covenantId: NACHO_COV.toUpperCase() },
          { tick: "NACHO", covenantId: "ab" },
        ],
      },
      held: [{ id: "NACHO", balance: "1", dec: "8" }],
    });
    expect(r.config?.tokens).toEqual([]);
    expect(r.migratableHeld).toEqual([]);
    expect(shown(r)).toBe("https://katbridge.com/migrate");
  });
});

test.describe("parseMigrationPayload", () => {
  test("accepts a katbridge subdomain and a JSON-string payload", () => {
    expect(
      migration.parseMigrationPayload(
        JSON.stringify({ ...PAYLOAD, url: "https://app.katbridge.com/m" }),
      ),
    ).toEqual({
      url: "https://app.katbridge.com/m",
      tokens: [{ tick: "NACHO", covenantId: NACHO_COV }],
    });
  });

  test("returns the parsed href, not the raw payload string", () => {
    expect(migration.webUrl("https://KatBridge.com/migrate")).toBe(
      "https://katbridge.com/migrate",
    );
    expect(migration.webUrl("https://katbridge.com")).toBe(
      "https://katbridge.com/",
    );
    expect(migration.webUrl("https://katbridge.com/a b")).toBe(
      "https://katbridge.com/a%20b",
    );
  });

  test("caps the token list and keeps valid erc20 entries only", () => {
    const tokens = Array.from({ length: 150 }, (_, i) => ({
      tick: `T${i}`,
      covenantId: NACHO_COV,
    }));
    const parsed = migration.parseMigrationPayload({ ...PAYLOAD, tokens });
    expect(parsed?.tokens.length).toBe(migration.MAX_MIGRATION_TOKENS);

    const withErc20 = migration.parseMigrationPayload({
      ...PAYLOAD,
      tokens: [
        {
          tick: "NACHO",
          covenantId: NACHO_COV,
          erc20: [
            { chainId: 1, address: `0x${"B".repeat(40)}` },
            { chainId: 0, address: `0x${"b".repeat(40)}` },
            { chainId: 1, address: "0x12" },
          ],
        },
      ],
    });
    expect(withErc20?.tokens[0].erc20).toEqual([
      { chainId: 1, address: `0x${"b".repeat(40)}` },
    ]);
  });

  test("isMigratableTick is case-insensitive and payload-only", () => {
    const config = migration.parseMigrationPayload(PAYLOAD);
    expect(migration.isMigratableTick(config, "Nacho")).toBe(true);
    expect(migration.isMigratableTick(config, "KASPY")).toBe(false);
    expect(migration.isMigratableTick(undefined, "NACHO")).toBe(false);
  });
});
