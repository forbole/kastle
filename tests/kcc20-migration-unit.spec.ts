import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";

type MigrationModule = typeof import("../lib/kcc20/migration");
type HookModule = typeof import("../hooks/useKcc20Migration");
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
 * Runs useKcc20Migration once against a PostHog stub carrying `flags` and
 * `payload`. The hook's own useFeatureFlags read is stubbed with the same
 * opt-in rule (only an explicit true), and the tokenlist stub records the
 * address it was asked for, so "no request while inactive" is observable.
 */
function renderMigration({
  flags,
  payload,
  held = [],
  isMainnet = true,
}: {
  flags: Flags;
  payload?: unknown;
  held?: { id: string; balance: string; dec: string }[];
  isMainnet?: boolean;
}) {
  const requested: (string | undefined)[] = [];
  let state: unknown;
  const react = {
    useContext: () => ({
      postHog: {
        getFeatureFlags: () => flags,
        getFeatureFlagPayload: (key: string) =>
          key === "kcc20_migration" ? payload : undefined,
        onFeatureFlags: () => () => {},
      },
    }),
    useState: (initial: unknown) => {
      if (state === undefined) state = initial;
      return [state, (next: unknown) => (state = next)];
    },
    useEffect: (effect: () => void) => effect(),
    useMemo: (fn: () => unknown) => fn(),
  };
  const run = load<HookModule>("hooks/useKcc20Migration.ts", {
    react,
    "@/contexts/PostHogWrapperProvider.tsx": { PostHogWrapperContext: {} },
    "@/hooks/useFeatureFlags": {
      useFeatureFlags: () => ({
        kcc20MigrationRoute: flags?.kcc20_migration_route === true,
      }),
    },
    "@/hooks/kasplex/useTokenListByAddress": {
      useTokenListByAddress: (address?: string) => {
        requested.push(address);
        return address ? held : undefined;
      },
    },
    "@/lib/kcc20/migration": migration,
  }).useKcc20Migration;
  run({ address: ADDRESS, isMainnet }); // effect fills state
  requested.length = 0;
  const result = run({ address: ADDRESS, isMainnet });
  return { ...result, requested };
}

const shown = (r: ReturnType<typeof renderMigration>) =>
  r.enabled && r.migratableHeld.length > 0 && r.config?.url;

test.describe("Bridge migrate row (useKcc20Migration)", () => {
  test("no migratable token held: hidden", () => {
    const r = renderMigration({
      flags: ON,
      payload: PAYLOAD,
      held: [
        { id: "KASPY", balance: "500", dec: "8" },
        { id: "NACHO", balance: "0", dec: "8" },
      ],
    });
    expect(shown(r)).toBeFalsy();
    expect(r.migratableHeld).toEqual([]);
    expect(r.requested).toEqual([ADDRESS]);
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

  test("bad payload (non-hex covenant): token dropped, row hidden", () => {
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
    expect(shown(r)).toBeFalsy();
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
