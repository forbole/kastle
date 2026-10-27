import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The KCC-20 components import chain logos, which Playwright's loader cannot
// import. esbuild bundles the real components with those assets emptied, and
// React with them so components and renderer share one copy.
type Modules = {
  createElement: typeof import("react").createElement;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  SendSelectTokenPage: typeof import("@/ui/popup/kcc20/SendSelectTokenPage").default;
  TokenItem: typeof import("@/ui/popup/kcc20/TokenItem").default;
};

let m: Modules;

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-a11y-unit-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        'export { default as SendSelectTokenPage } from "@/ui/popup/kcc20/SendSelectTokenPage";',
        'export { default as TokenItem } from "@/ui/popup/kcc20/TokenItem";',
        'export { createElement } from "react";',
        'export { renderToStaticMarkup } from "react-dom/server";',
      ].join("\n"),
      resolveDir: repo,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    // react-dom/server require()s node built-ins.
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    outfile,
    tsconfig: path.join(repo, "tsconfig.json"),
    jsx: "automatic",
    loader: { ".png": "empty", ".svg": "empty" },
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
});

const pageProps = {
  tokens: [],
  searchQuery: "",
  onSearchChange: () => {},
  selectedFilters: [],
  onFiltersChange: () => {},
  onTokenSelect: () => {},
};

test("SendSelectTokenPage hides the back button without onBack", () => {
  const html = m.renderToStaticMarkup(
    m.createElement(m.SendSelectTokenPage, pageProps),
  );
  expect(html).not.toContain('aria-label="Back"');

  const withBack = m.renderToStaticMarkup(
    m.createElement(m.SendSelectTokenPage, { ...pageProps, onBack: () => {} }),
  );
  expect(withBack).toContain('aria-label="Back"');
});

test("SendSelectTokenPage search input has a label", () => {
  const html = m.renderToStaticMarkup(
    m.createElement(m.SendSelectTokenPage, pageProps),
  );
  expect(html).toMatch(
    /<label[^>]*><svg[^]*?<span class="sr-only">Search tokens<\/span><input/,
  );
});

test("TokenItem names the asset type for screen readers", () => {
  const render = (network: "kcc20" | "krc20") =>
    m.renderToStaticMarkup(
      m.createElement(m.TokenItem, {
        name: "KRON",
        network,
        onClick: () => {},
      }),
    );
  expect(render("kcc20")).toContain('<span class="sr-only">Kaspa-KCC20</span>');
  expect(render("krc20")).toContain('<span class="sr-only">Kaspa-KRC20</span>');
});
