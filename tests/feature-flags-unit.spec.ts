import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";

type FeatureFlagsModule = typeof import("../hooks/useFeatureFlags");
type FeatureFlags = Record<string, string | boolean> | undefined;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The hook's import chain (provider -> lib/utils -> SettingsContext) reaches
 * .svg assets Node can't load, so evaluate the real source with its two
 * imports stubbed.
 */
function loadFeatureFlagsModule(
  react: object,
  {
    isProduction = false,
    setTimeout = globalThis.setTimeout,
    localOptIn = false,
    kassealOptIn = false,
  } = {},
): FeatureFlagsModule {
  const source = fs.readFileSync(
    path.join(__dirname, "../hooks/useFeatureFlags.ts"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const stubs: Record<string, unknown> = {
    react,
    "@/contexts/PostHogWrapperProvider.tsx": { PostHogWrapperContext: {} },
    "@/lib/utils.ts": { isProduction },
    // Carries the local opt-in, whose `import.meta` cannot run as CommonJS.
    "@/lib/kcc20/local-opt-in": { standardLocalOptIn: () => localOptIn },
    "@/lib/kcc20/local-opt-in.ts": { standardLocalOptIn: () => localOptIn },
    "@/lib/kasseal/local-opt-in": { kassealLocalOptIn: () => kassealOptIn },
  };
  const module = { exports: {} as FeatureFlagsModule };
  new Function("require", "module", "exports", "setTimeout", outputText)(
    (id: string) => stubs[id],
    module,
    module.exports,
    setTimeout,
  );
  return module.exports;
}

/**
 * Production mount: one state slot per useState, effects run once, flags
 * delivered by PostHog via `deliver`, the 5 s timeout fired via `timeOut`.
 */
function mountProductionFeatureFlags() {
  const slots: unknown[] = [];
  let slot = 0;
  let mounted = false;
  let featureFlags: FeatureFlags;
  let onFlags = () => {};
  let fireTimeout = () => {};
  const { useFeatureFlags: hook } = loadFeatureFlagsModule(
    {
      useContext: () => ({
        postHog: {
          getFeatureFlags: () => featureFlags,
          onFeatureFlags: (cb: () => void) => {
            onFlags = cb;
            return () => {};
          },
        },
      }),
      useState: (initial: unknown) => {
        const i = slot++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], (next: unknown) => (slots[i] = next)];
      },
      useEffect: (effect: () => void) => {
        if (!mounted) effect();
      },
    },
    {
      isProduction: true,
      setTimeout: ((cb: () => void) => {
        fireTimeout = cb;
        return 0;
      }) as unknown as typeof globalThis.setTimeout,
    },
  );
  const render = () => {
    slot = 0;
    const result = hook();
    mounted = true;
    return result;
  };
  render();
  return {
    render,
    deliver: (next: FeatureFlags) => {
      featureFlags = next;
      onFlags();
    },
    timeOut: () => fireTimeout(),
  };
}

/** Runs useFeatureFlags against a PostHog whose getFeatureFlags() returns `featureFlags`. */
function renderFeatureFlags(
  featureFlags: FeatureFlags,
  options: {
    isProduction?: boolean;
    localOptIn?: boolean;
    kassealOptIn?: boolean;
  } = {},
) {
  let state = {};
  const render = loadFeatureFlagsModule(
    {
      useContext: () => ({
        postHog: {
          getFeatureFlags: () => featureFlags,
          onFeatureFlags: () => () => {},
        },
      }),
      useState: () => [state, (next: object) => (state = next)],
      useEffect: (effect: () => void) => effect(),
    },
    options,
  ).useFeatureFlags;
  render(); // the effect copies the PostHog flags into state
  return render();
}

// The standard rows read kascov, a third party: off unless the flag says true
// or a local build opts in.
test.describe("kcc20 standard flag", () => {
  test("is off by default and needs an explicit true", () => {
    expect(renderFeatureFlags({}).isKcc20StandardEnabled).toBe(false);
    expect(
      renderFeatureFlags({ kcc20_standard_enabled: false })
        .isKcc20StandardEnabled,
    ).toBe(false);
    expect(
      renderFeatureFlags({ kcc20_standard_enabled: true })
        .isKcc20StandardEnabled,
    ).toBe(true);
  });

  test("a local build can opt in, but production cannot", () => {
    expect(
      renderFeatureFlags({}, { localOptIn: true }).isKcc20StandardEnabled,
    ).toBe(true);
    expect(
      renderFeatureFlags({}, { localOptIn: true, isProduction: true })
        .isKcc20StandardEnabled,
    ).toBe(false);
  });
});

// swap_enabled_extension / bridge_enabled_extension are default-on kill
// switches: only an explicit off may hide the feature.
test.describe("swap/bridge kill-switch interpretation", () => {
  const { isFlagEnabled } = loadFeatureFlagsModule({});

  test("undefined (flags not loaded, PostHog unreachable) is enabled", () => {
    expect(isFlagEnabled(undefined)).toBe(true);
  });

  test("boolean true is enabled, boolean false is disabled", () => {
    expect(isFlagEnabled(true)).toBe(true);
    expect(isFlagEnabled(false)).toBe(false);
  });

  test('string "false" is disabled, not slipped through as enabled', () => {
    expect(isFlagEnabled("false")).toBe(false);
    expect(isFlagEnabled("False")).toBe(false);
    expect(isFlagEnabled("FALSE")).toBe(false);
  });

  test('string "true" and multivariate variant keys are enabled', () => {
    expect(isFlagEnabled("true")).toBe(true);
    expect(isFlagEnabled("control")).toBe(true);
  });
});

test.describe("useFeatureFlags", () => {
  test("PostHog not loaded yet: swap and bridge stay enabled", () => {
    expect(renderFeatureFlags(undefined)).toMatchObject({
      isSwapEnabled: true,
      isBridgeEnabled: true,
    });
  });

  test("dotK kill switch: default-on, explicit false disables only dotK", () => {
    expect(renderFeatureFlags(undefined)).toMatchObject({
      isDotkEnabled: true,
    });
    expect(renderFeatureFlags({})).toMatchObject({ isDotkEnabled: true });
    expect(renderFeatureFlags({ dotk_enabled_extension: false })).toMatchObject(
      {
        isDotkEnabled: false,
        isSwapEnabled: true,
        isBridgeEnabled: true,
      },
    );
    expect(
      renderFeatureFlags({ dotk_enabled_extension: "false" }),
    ).toMatchObject({ isDotkEnabled: false });
  });

  test("inactive flags, omitted from the /decide v3 map, stay enabled", () => {
    expect(renderFeatureFlags({ swap_enabled: false })).toMatchObject({
      isSwapEnabled: true,
      isBridgeEnabled: true,
    });
  });

  test("boolean values disable only the flag that is false", () => {
    expect(
      renderFeatureFlags({
        swap_enabled_extension: false,
        bridge_enabled_extension: true,
      }),
    ).toMatchObject({ isSwapEnabled: false, isBridgeEnabled: true });
  });

  test('string values disable only the flag that is "false"', () => {
    expect(
      renderFeatureFlags({
        swap_enabled_extension: "true",
        bridge_enabled_extension: "false",
      }),
    ).toMatchObject({ isSwapEnabled: true, isBridgeEnabled: false });
  });
});

// The KCC-20 send route waits on isKcc20Loading, so a flagged-on user is not
// bounced to the dashboard before PostHog delivers flags.
test.describe("useFeatureFlags KCC-20 loading (production)", () => {
  test("no flags delivered yet: KCC-20 is loading", () => {
    const flags = mountProductionFeatureFlags();
    expect(flags.render()).toMatchObject({
      isKcc20Loading: true,
      isKcc20Enabled: false,
    });
  });

  test("flags map arrives: loading ends, enabled follows the value", () => {
    const on = mountProductionFeatureFlags();
    on.deliver({ kcc20_enabled_extension: true });
    expect(on.render()).toMatchObject({
      isKcc20Loading: false,
      isKcc20Enabled: true,
    });

    const off = mountProductionFeatureFlags();
    off.deliver({ kcc20_enabled_extension: false });
    expect(off.render()).toMatchObject({
      isKcc20Loading: false,
      isKcc20Enabled: false,
    });
  });

  test("flags map omits the KCC-20 key: loading ends at once, KCC-20 off", () => {
    const flags = mountProductionFeatureFlags();
    flags.deliver({ swap_enabled_extension: true });
    expect(flags.render()).toMatchObject({
      isKcc20Loading: false,
      isKcc20Enabled: false,
    });
  });

  test("5 s timeout with no flags: loading ends and KCC-20 fails closed", () => {
    const flags = mountProductionFeatureFlags();
    flags.timeOut();
    expect(flags.render()).toMatchObject({
      isKcc20Loading: false,
      isKcc20Enabled: false,
    });
  });
});

test.describe("useFeatureFlags Kasseal (production)", () => {
  test("no flags delivered yet: Kasseal is loading and off", () => {
    const flags = mountProductionFeatureFlags();
    expect(flags.render()).toMatchObject({
      isKassealLoading: true,
      isKassealEnabled: false,
    });
  });

  test("only an explicit true enables Kasseal", () => {
    const on = mountProductionFeatureFlags();
    on.deliver({ kasseal_enabled_extension: true });
    expect(on.render()).toMatchObject({
      isKassealLoading: false,
      isKassealEnabled: true,
    });

    const off = mountProductionFeatureFlags();
    off.deliver({ kasseal_enabled_extension: false });
    expect(off.render()).toMatchObject({
      isKassealLoading: false,
      isKassealEnabled: false,
    });

    // A string variant is not `true`: fail closed, unlike the kill switches.
    const variant = mountProductionFeatureFlags();
    variant.deliver({ kasseal_enabled_extension: "true" });
    expect(variant.render()).toMatchObject({ isKassealEnabled: false });
  });

  test("flags map omits the Kasseal key: loading ends, Kasseal off", () => {
    const flags = mountProductionFeatureFlags();
    flags.deliver({ kcc20_enabled_extension: true });
    expect(flags.render()).toMatchObject({
      isKassealLoading: false,
      isKassealEnabled: false,
    });
  });

  test("5 s timeout with no flags: Kasseal fails closed", () => {
    const flags = mountProductionFeatureFlags();
    flags.timeOut();
    expect(flags.render()).toMatchObject({
      isKassealLoading: false,
      isKassealEnabled: false,
    });
  });
});

// A dev build must not reach a third-party launchpad unless asked to.
test.describe("useFeatureFlags Kasseal (development)", () => {
  test("is off without the flag and needs an explicit true", () => {
    expect(renderFeatureFlags({}).isKassealEnabled).toBe(false);
    expect(
      renderFeatureFlags({ kasseal_enabled_extension: false }).isKassealEnabled,
    ).toBe(false);
    expect(
      renderFeatureFlags({ kasseal_enabled_extension: true }).isKassealEnabled,
    ).toBe(true);
  });

  test("a local build can opt in, but production cannot", () => {
    expect(
      renderFeatureFlags({}, { kassealOptIn: true }).isKassealEnabled,
    ).toBe(true);
    expect(
      renderFeatureFlags({}, { kassealOptIn: true, isProduction: true })
        .isKassealEnabled,
    ).toBe(false);
  });
});
