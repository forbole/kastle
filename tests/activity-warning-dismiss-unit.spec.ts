import { test, expect, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";

// The real Activity screen, bundled with its data hooks stubbed: the feed
// reports window.__feed's degradation codes, browser.storage.local is an
// in-page object (window.__store), so nothing reaches the network.

const repo = path.resolve(import.meta.dirname, "..");

const STUBS: Record<string, string> = {
  "hooks/useActivityFeed": `export const useActivityFeed = () => ({
    rows: [], error: undefined, isRefreshing: false, refresh() {},
    swapSource: null, bridgeSource: null, depositSource: null, kurveSource: null,
    ...window.__feed });`,
  "hooks/useRpcClientStateful": `export default () => ({ networkId: "mainnet" });`,
  "hooks/useKaspaPrice": `export default () => ({ kaspaPrice: 0 });`,
  "hooks/evm/provider/useZealousSwap": `
    export const useZealousSwapTokensMetadata = () => ({ data: undefined });
    export const useZealousSwapIgraTokensMetadata = () => ({ data: undefined });
    export const ZEALOUS_SWAP_IMAGE_URL = ""; export const ZEALOUS_SWAP_IGRA_IMAGE_URL = "";`,
  "hooks/useSettings": `export const useSettings = () => [{}];`,
  "hooks/wallet/useWalletManager": `export default () => ({ account: undefined });`,
  "hooks/useFeatureFlags": `export const useFeatureFlags = () => ({ isKcc20Enabled: false });`,
  "lib/kcc20/useKcc20Tokens": `export default () => ({ data: undefined });`,
  "lib/kcc20/useKcc20Price": `export const useKcc20CachedPrices = () => ({});`,
  "lib/kcc20/providers/kascov": `export const fetchStandardMarketPrice = async () => undefined;`,
  "lib/kcc20/swap": `export const fetchKronMarkets = async () => [];`,
  "lib/activity/mappers": `export const rowsForPage = () => [];`,
  "lib/activity/adapters": `export const toActivityItem = () => ({});
    export const kcc20UsdPrices = () => new Map(); export const sameSpots = () => true;`,
  "components/BottomNav": `export default () => null;`,
  "components/swap-bridge/ui": `export const BottomSheet = () => null; export const Skeleton = () => null;`,
};

const stubs: Plugin = {
  name: "activity-stubs",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2).replace(/\.(tsx?)$/, "");
      if (STUBS[rel] !== undefined) return { path: rel, namespace: "stub" };
      return undefined;
    });
    b.onResolve({ filter: /^@\// }, async (args) =>
      b.resolve(`./${args.path.slice(2)}`, {
        resolveDir: repo,
        kind: args.kind,
      }),
    );
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};

let bundle: string;

test.beforeAll(async () => {
  const out = await build({
    stdin: {
      contents: `
        import { createRoot } from "react-dom/client";
        import { MemoryRouter } from "react-router-dom";
        import Activity from "@/components/screens/Activity";
        createRoot(document.getElementById("root")).render(
          <MemoryRouter initialEntries={["/activity?type=" + window.__type]}>
            <Activity />
          </MemoryRouter>,
        );`,
      loader: "tsx",
      resolveDir: repo,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    loader: { ".svg": "dataurl", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [stubs],
    logLevel: "error",
  });
  bundle = out.outputFiles[0].text;
});

const KEY = "activity-warnings-dismissed";
const SWAP_MSG =
  "Couldn't load swap history — some swaps may be missing. Refresh to retry.";
const KCC20_MSG =
  "Couldn't load KCC-20 swaps — some KCC-20 swaps may be missing. Other swaps are shown. Refresh to retry.";
const BRIDGE_MSG =
  "Couldn't reach the KAT bridge — this list may be incomplete. Refresh to retry.";

async function mount(
  page: Page,
  opts: {
    type?: "swap" | "bridge";
    feed: Record<string, unknown>;
    store?: Record<string, unknown>;
    failGet?: boolean;
    failSet?: boolean;
  },
) {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate((o) => {
    const w = window as unknown as Record<string, unknown>;
    w.__type = o.type ?? "swap";
    w.__feed = o.feed;
    w.__store = structuredClone(o.store ?? {});
    w.browser = {
      tabs: { create() {} },
      storage: {
        local: {
          async get(k: string) {
            if (o.failGet) throw new Error("read failed");
            return { [k]: (w.__store as Record<string, unknown>)[k] };
          },
          async set(v: Record<string, unknown>) {
            if (o.failSet) throw new Error("write failed");
            Object.assign(w.__store as object, structuredClone(v));
          },
        },
      },
    };
  }, opts);
  await page.addScriptTag({ content: bundle });
}

const stored = (page: Page) =>
  page.evaluate(
    (k) =>
      (window as unknown as { __store: Record<string, unknown> }).__store[k],
    KEY,
  );

test("close removes the panel and stores the dismissed codes for swap", async ({
  page,
}) => {
  await mount(page, {
    feed: {
      swapSource: [
        "swap_history_unavailable",
        "swap_history_kcc20_unavailable",
      ],
    },
  });
  await expect(page.getByText(SWAP_MSG)).toBeVisible();
  await expect(page.getByText(KCC20_MSG)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(SWAP_MSG)).toHaveCount(0);
  await expect(page.getByText(KCC20_MSG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  await expect
    .poll(() => stored(page))
    .toEqual({
      swap: ["swap_history_unavailable", "swap_history_kcc20_unavailable"],
      bridge: [],
    });
});

test("a stored dismissal is honoured on mount; a never-dismissed code still renders", async ({
  page,
}) => {
  await mount(page, {
    feed: {
      swapSource: [
        "swap_history_unavailable",
        "swap_history_kcc20_unavailable",
      ],
    },
    store: { [KEY]: { swap: ["swap_history_unavailable"], bridge: [] } },
  });
  await expect(page.getByText(KCC20_MSG)).toBeVisible();
  await expect(page.getByText(SWAP_MSG)).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(KCC20_MSG)).toHaveCount(0);
  await expect
    .poll(() => stored(page))
    .toEqual({
      swap: ["swap_history_unavailable", "swap_history_kcc20_unavailable"],
      bridge: [],
    });
});

test("bridge page: dismissals are kept per page type", async ({ page }) => {
  await mount(page, {
    type: "bridge",
    feed: { bridgeSource: "bridge_history_unavailable" },
    // A swap dismissal of the same shape must not hide a bridge code.
    store: { [KEY]: { swap: ["bridge_history_unavailable"], bridge: [] } },
  });
  await expect(page.getByText(BRIDGE_MSG)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(BRIDGE_MSG)).toHaveCount(0);
  await expect
    .poll(() => stored(page))
    .toEqual({
      swap: ["bridge_history_unavailable"],
      bridge: ["bridge_history_unavailable"],
    });
});

test("storage errors: a failed read shows every warning, a failed write still hides", async ({
  page,
}) => {
  await mount(page, {
    feed: { swapSource: "swap_history_unavailable" },
    failGet: true,
    failSet: true,
  });
  await expect(page.getByText(SWAP_MSG)).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText(SWAP_MSG)).toHaveCount(0);
});

test("a stored code the answered feed no longer reports is pruned from storage", async ({
  page,
}) => {
  await mount(page, {
    feed: { swapSource: "swap_history_kcc20_unavailable" },
    store: {
      [KEY]: {
        swap: ["swap_history_unavailable", "swap_history_kcc20_unavailable"],
        bridge: ["bridge_history_unavailable"],
      },
    },
  });
  await expect(page.getByText(KCC20_MSG)).toHaveCount(0);
  // Only the recovered swap code goes; the bridge page's list is untouched.
  await expect
    .poll(() => stored(page))
    .toEqual({
      swap: ["swap_history_kcc20_unavailable"],
      bridge: ["bridge_history_unavailable"],
    });
});

test("a stored code the feed still reports stays dismissed and hidden", async ({
  page,
}) => {
  const store = {
    [KEY]: { swap: ["swap_history_unavailable"], bridge: [] },
  };
  await mount(page, {
    feed: { swapSource: "swap_history_unavailable" },
    store,
  });
  // Mount settles: storage read, effect ran, nothing to prune.
  await page.waitForTimeout(300);
  await expect(page.getByText(SWAP_MSG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  expect(await stored(page)).toEqual(store[KEY]);
});

test("an unanswered feed leaves the stored dismissals untouched", async ({
  page,
}) => {
  const store = {
    [KEY]: { swap: ["swap_history_unavailable"], bridge: [] },
  };
  await mount(page, { feed: { swapSource: undefined }, store });
  await page.waitForTimeout(300);
  expect(await stored(page)).toEqual(store[KEY]);
});

test("Dismiss hit box sits inside the warning panel; one-line panel stays compact", async ({
  page,
}) => {
  // Real Tailwind CSS for Activity.tsx (default theme covers every class the
  // panel uses), so the bounding boxes below are the rendered geometry.
  const { default: postcss } = await import("postcss");
  const { default: tailwindcss } = await import("tailwindcss");
  const { css } = await postcss([
    tailwindcss({
      content: [path.join(repo, "components/screens/Activity.tsx")],
    }),
  ]).process("@tailwind base; @tailwind utilities;", { from: undefined });
  await mount(page, { feed: { swapSource: "swap_history_unavailable" } });
  await page.addStyleTag({ content: css });
  const btn = page.getByRole("button", { name: "Dismiss" });
  await expect(btn).toBeVisible();
  const g = await btn.evaluate((b) => {
    const r = b.getBoundingClientRect();
    const p = b.parentElement!.getBoundingClientRect();
    return {
      b: {
        t: r.top,
        b: r.bottom,
        l: r.left,
        r: r.right,
        w: r.width,
        h: r.height,
      },
      p: { t: p.top, b: p.bottom, l: p.left, r: p.right, h: p.height },
    };
  });
  console.log("dismiss geometry:", JSON.stringify(g));
  expect(g.b.t).toBeGreaterThanOrEqual(g.p.t - 0.5);
  expect(g.b.b).toBeLessThanOrEqual(g.p.b + 0.5);
  expect(g.b.l).toBeGreaterThanOrEqual(g.p.l - 0.5);
  expect(g.b.r).toBeLessThanOrEqual(g.p.r + 0.5);
  expect(g.b.w).toBeGreaterThanOrEqual(44);
  expect(g.b.h).toBeGreaterThanOrEqual(44);
  expect(g.p.h).toBeLessThanOrEqual(48);
});
