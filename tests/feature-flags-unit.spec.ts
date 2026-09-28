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
function loadFeatureFlagsModule(react: object): FeatureFlagsModule {
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
    "@/lib/utils.ts": { isProduction: false },
  };
  const module = { exports: {} as FeatureFlagsModule };
  new Function("require", "module", "exports", outputText)(
    (id: string) => stubs[id],
    module,
    module.exports,
  );
  return module.exports;
}

/** Runs useFeatureFlags against a PostHog whose getFeatureFlags() returns `featureFlags`. */
function renderFeatureFlags(featureFlags: FeatureFlags) {
  let state = {};
  const render = loadFeatureFlagsModule({
    useContext: () => ({
      postHog: {
        getFeatureFlags: () => featureFlags,
        onFeatureFlags: () => () => {},
      },
    }),
    useState: () => [state, (next: object) => (state = next)],
    useEffect: (effect: () => void) => effect(),
  }).useFeatureFlags;
  render(); // the effect copies the PostHog flags into state
  return render();
}

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
    expect(renderFeatureFlags(undefined)).toEqual({
      isSwapEnabled: true,
      isBridgeEnabled: true,
    });
  });

  test("inactive flags, omitted from the /decide v3 map, stay enabled", () => {
    expect(renderFeatureFlags({ swap_enabled: false })).toEqual({
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
    ).toEqual({ isSwapEnabled: false, isBridgeEnabled: true });
  });

  test('string values disable only the flag that is "false"', () => {
    expect(
      renderFeatureFlags({
        swap_enabled_extension: "true",
        bridge_enabled_extension: "false",
      }),
    ).toEqual({ isSwapEnabled: true, isBridgeEnabled: false });
  });
});
