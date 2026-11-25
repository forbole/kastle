import { test, expect } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The real lib/instrument.ts, bundled with Sentry.init recording its options,
// isProduction forced on and a fake `browser.runtime`, so the gate is read
// exactly as the production build reads it.

const repo = path.resolve(import.meta.dirname, "..");

const STUBS: Record<string, string> = {
  "@sentry/react": `export const init = (o) => { globalThis.__sentryInit = o; };`,
  "@/lib/utils.ts": `export const isProduction = true;`,
  "@/lib/sentry-scrub.ts": `export const sentryScrubHooks = {};`,
};

const stubs: Plugin = {
  name: "instrument-stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) =>
      STUBS[args.path] !== undefined
        ? { path: args.path, namespace: "stub" }
        : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};

type Nav = Pick<Navigator, "webdriver" | "userAgent">;
type Mod = { isAutomatedBrowser: (nav: Nav) => boolean };

let dir: string;
let file: string;
let runs = 0;

// Each load is a fresh module evaluation under the given navigator, returning
// the module and the `enabled` value it handed to Sentry.init.
// The globals it sets are restored before it returns, so a reused worker
// never sees them in a later spec file.
async function load(nav: Nav): Promise<{ mod: Mod; enabled: unknown }> {
  const keys = ["navigator", "browser", "__sentryInit"] as const;
  const saved = keys.map((k) => Object.getOwnPropertyDescriptor(globalThis, k));
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: nav,
      configurable: true,
    });
    (globalThis as { browser?: unknown }).browser = {
      runtime: { getManifest: () => ({ version: "2.63.2" }) },
    };
    const mod = (await import(
      `${pathToFileURL(file).href}?run=${runs++}`
    )) as Mod;
    const init = (globalThis as { __sentryInit?: { enabled: unknown } })
      .__sentryInit;
    return { mod, enabled: init?.enabled };
  } finally {
    keys.forEach((k, i) => {
      const d = saved[i];
      if (d) Object.defineProperty(globalThis, k, d);
      else delete (globalThis as Record<string, unknown>)[k];
    });
  }
}

const REAL_USER: Nav = {
  webdriver: false,
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/156 Safari/537",
};

test.beforeAll(async () => {
  const out = await build({
    entryPoints: [path.join(repo, "lib/instrument.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    plugins: [stubs],
  });
  dir = mkdtempSync(path.join(tmpdir(), "instrument-"));
  file = path.join(dir, "i.mjs");
  writeFileSync(file, out.outputFiles[0].text);
});

test.afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

test("webdriver flag marks the browser as automated", async () => {
  const { mod } = await load(REAL_USER);
  expect(
    mod.isAutomatedBrowser({
      webdriver: true,
      userAgent: "Mozilla/5.0 Chrome/156",
    }),
  ).toBe(true);
});

test("HeadlessChrome user agent marks the browser as automated", async () => {
  const { mod } = await load(REAL_USER);
  expect(
    mod.isAutomatedBrowser({
      webdriver: false,
      userAgent: "Mozilla/5.0 HeadlessChrome/156",
    }),
  ).toBe(true);
});

test("a normal Chrome is not automated", async () => {
  const { mod } = await load(REAL_USER);
  expect(mod.isAutomatedBrowser(REAL_USER)).toBe(false);
});

test("a real user's error is still captured: production init stays enabled", async () => {
  const { enabled } = await load(REAL_USER);
  expect(enabled).toBe(true);
});

test("an automated production run does not initialise Sentry", async () => {
  const { enabled } = await load({
    webdriver: true,
    userAgent: "Mozilla/5.0 HeadlessChrome/156",
  });
  expect(enabled).toBe(false);
});
