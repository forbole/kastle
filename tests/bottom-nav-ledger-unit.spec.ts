import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

/** Evaluates the real BottomNav source with its app imports stubbed. */
function renderNav(walletType: string, navigate: (p: string) => void) {
  const source = fs.readFileSync(
    path.join(__dirname, "../components/BottomNav.tsx"),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  });
  const icon = () => null;
  const stubs: Record<string, unknown> = {
    react: React,
    "react-router-dom": {
      useLocation: () => ({ pathname: "/dashboard" }),
      useNavigate: () => navigate,
    },
    "lucide-react": { ArrowRightLeft: icon, History: icon },
    "tailwind-merge": {
      twMerge: (...c: unknown[]) => c.filter(Boolean).join(" "),
    },
    "@/assets/images/home.svg": "",
    "@/assets/images/home-filled.svg": "",
    "@/hooks/useFeatureFlags": {
      useFeatureFlags: () => ({
        isSwapEnabled: true,
        isBridgeEnabled: true,
        isActivityEnabled: true,
      }),
    },
    "@/hooks/wallet/useWalletManager": {
      __esModule: true,
      default: () => ({ wallet: { type: walletType } }),
    },
    // react-tooltip needs a DOM; expose the tooltip text the real one receives
    "@/components/HoverTooltip": {
      __esModule: true,
      default: ({ text, id, children }: any) =>
        React.createElement("div", { "data-tip": text, id }, children),
    },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", outputText)(
    (id: string) => stubs[id] ?? {},
    module,
    module.exports,
  );
  const Nav = module.exports.default ?? module.exports.BottomNav;
  return renderToStaticMarkup(React.createElement(Nav));
}

test("ledger wallet: Swap and Bridge are aria-disabled with tooltip", () => {
  const html = renderNav("ledger", () => {});
  for (const label of ["Swap", "Bridge"]) {
    const tip = `Ledger doesn&#x27;t support ${label} function currently.`;
    expect(html).toContain(`data-tip="${tip}"`);
    const btn = html.match(
      new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`),
    );
    expect(btn?.[0]).toContain('aria-disabled="true"');
    expect(btn?.[0]).toContain("opacity-20");
  }
  const home = html.match(/<button[^>]*aria-label="Home"[^>]*>/);
  expect(home?.[0]).not.toContain("aria-disabled");
});

test("non-ledger wallet: no gating", () => {
  const html = renderNav("mnemonic", () => {});
  expect(html).not.toContain("aria-disabled");
  expect(html).not.toContain("data-tip");
});
