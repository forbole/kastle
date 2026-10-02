import { chromium, expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keyring } from "@/lib/keyring-manager";

async function screenBundle() {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/components/GeneralHeader":
      "export default function Header({onBack}) { return <button onClick={onBack}>Back</button>; }",
    "@/components/Toast.tsx": "export default {success(){}, error(){}};",
    "@/hooks/wallet/useWalletImporter":
      "export default function useWalletImporter(){return {createNewWallet:async()=>'',importWalletByPrivateKey:async()=>''};}",
    "@/hooks/useAnalytics":
      "export default function useAnalytics(){return {emitWalletCreated(){}};}",
    "@/ui/popup/add-wallet/AddWalletPage":
      "export default function AddWalletPage({options,advancedOptions}){return <div>{[...options,...advancedOptions].map(x=><button key={x.label} onClick={x.onClick}>{x.label}</button>)}</div>;}",
    "@/lib/utils":
      "export const openFullPage=()=>{}; export const sendMessage=(method)=>window.__fixtureMessage(method);",
    "@/hooks/useSettings":
      "export const useSettings=()=>[window.__fixtureSettings,null,false];",
    "@/hooks/useStorageState":
      "export default function useStorageState(key){return key.includes('connections') ? [{},null,false] : [window.__fixtureExperimental,null,false];}",
    "@/hooks/useSwitchNetwork":
      "export default function useSwitchNetwork(){return {switchZKasNetwork:async()=>{},switchKaspaNetwork:async()=>{}};}",
    "@/hooks/wallet/useWalletManager":
      "export default function useWalletManager(){return {walletSettings:{selectedWalletId:undefined,selectedAccountIndex:undefined},refreshKaspaAddresses:async()=>{}};}",
    "@/hooks/useKeyring.ts":
      "export default function useKeyring(){return {keyringInitialize:async()=>{}};}",
    "@/lib/zkas/popup-client":
      "export const getZKasDaemonBirthday=async()=>0; export const registerSelectedZKasWallet=async()=>{}; export const previewZKasSeed=async()=>{if(window.__holdPreview) await new Promise(resolve=>window.__releasePreview=resolve); return {network:'mainnet',address:'dummy-address'};}; export const importZKasSeed=async()=>{}; export const getSelectedZKasAddress=async()=>null;",
    "@/lib/zkas/client":
      "export const getZKasDaemonOriginPattern=()=> 'http://localhost/*';",
    "@/lib/zkas/connection":
      "export const ZKAS_CONNECTIONS_KEY='local:connections';",
    "@/contexts/SettingsContext": "export const SETTINGS_KEY='local:settings';",
    "@/contexts/WalletManagerContext":
      "export const WALLET_SETTINGS='local:wallet-settings';",
    "@/lib/wallet-settings-storage":
      "export const withWalletSettingsLock=async(fn)=>fn();",
    "@/lib/settings-storage": "export const updateSettingsLocked=async()=>{};",
    "@/wasm/core/kaspa": "export class PrivateKey { constructor(){} }",
    "@/lib/wallet/wasm-lifecycle.ts": "export const withOwned=(fn)=>fn(x=>x);",
  };
  const result = await build({
    stdin: {
      contents: `
        import {createRoot} from 'react-dom/client';
        import {createMemoryRouter, Navigate, RouterProvider} from 'react-router-dom';
        import AddWallet from './components/screens/AddWallet';
        import ImportPrivateKey from './components/screens/full-pages/ImportPrivateKey';
        import ZKasSettings from './components/screens/zkas/ZKasSettings';
        function Guard({children}) {
          if (!window.__fixtureUnlocked) return <Navigate to='/unlock' replace/>;
          if (!window.__fixtureSettings.preview || window.__fixtureExperimental === false)
            return <Navigate to='/dashboard' replace/>;
          return children;
        }
        const router=createMemoryRouter([
          {path:'/add-wallet',element:<AddWallet/>},
          {path:'/import-private-key',element:<ImportPrivateKey/>},
          {path:'/zkas/settings',element:<Guard><ZKasSettings/></Guard>},
          {path:'/zkas-asset',element:<p>ZKas asset</p>},
          {path:'/dashboard',element:<p>Dashboard</p>},
          {path:'/unlock',element:<p>Unlock</p>}
        ],{initialEntries:['/add-wallet']});
        window.__router=router;
        createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
      `,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    write: false,
    plugins: [
      {
        name: "screen-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\// }, (args) => {
            const key = args.path.replace(/\.(tsx?|jsx?)$/, "");
            const mocked = Object.keys(mocks).find(
              (candidate) => candidate.replace(/\.(tsx?|jsx?)$/, "") === key,
            );
            if (mocked) return { path: mocked, namespace: "screen-mock" };
            const relative = args.path.slice(2);
            const found = [relative, `${relative}.ts`, `${relative}.tsx`].find(
              (candidate) => existsSync(resolve(root, candidate)),
            );
            return found ? { path: resolve(root, found) } : undefined;
          });
          plugin.onLoad({ filter: /.*/, namespace: "screen-mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  stop();
  return result.outputFiles[0].text;
}

test("pairing is discoverable before ZKas selection and return flags cannot bypass gates", async () => {
  const keyring = new Keyring(`bearer-discovery-${crypto.randomUUID()}`);
  const entries = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => entries.get(key) ?? null,
      setItem: async (key: string, value: unknown) => entries.set(key, value),
      removeItem: async (key: string) => entries.delete(key),
    },
  });
  await keyring.initialize("dummy-password");
  const bundle = await screenBundle();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) =>
      console.error("Discovery page error", error),
    );
    await page.exposeFunction("__fixtureMessage", async (method: string) => {
      if (method === "KEYRING_STATUS")
        return { isInitialized: true, isUnlocked: keyring.isUnlocked() };
      if (method === "ZKAS_DAEMON_BEARER_LIST") return { records: [] };
      if (method === "ZKAS_HISTORY_GRANTS_LIST")
        return {
          account: {
            walletId: "",
            accountIndex: 0,
            address0: "",
            network: "mainnet",
          },
          records: [],
        };
      return {};
    });
    await page.addInitScript(() => {
      (
        window as typeof window & { __fixtureSettings: unknown }
      ).__fixtureSettings = {
        preview: true,
        activeChain: "kaspa",
        networkId: "mainnet",
        zkasDaemonUrls: { mainnet: "http://localhost:8765" },
      };
      (
        window as typeof window & { __fixtureExperimental: boolean }
      ).__fixtureExperimental = true;
      (
        window as typeof window & { __fixtureUnlocked: boolean }
      ).__fixtureUnlocked = true;
    });
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).pathname === "/app.js")
        await route.fulfill({ contentType: "text/javascript", body: bundle });
      else
        await route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/app.js"></script>',
        });
    });
    await page.goto("https://dummy-discovery.invalid/");
    await page
      .getByRole("button", { name: "Configure ZKas daemon credential" })
      .click();
    await expect(
      page.getByRole("region", { name: "Daemon transport credential" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __router: { state: { location: { state: unknown } } };
            }
          ).__router.state.location.state,
      ),
    ).toEqual({ pairingReturn: "add-wallet" });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("button", { name: "Configure ZKas daemon credential" }),
    ).toBeVisible();

    await page.evaluate(() =>
      (
        window as typeof window & {
          __router: { navigate: (path: string, options?: object) => void };
        }
      ).__router.navigate("/import-private-key", {
        state: { showZKasSeed: true },
      }),
    );
    await expect(
      page.getByLabel("ZKas spending seed (64 hexadecimal characters)"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Leaving this screen clears the entered seed and address preview.",
      ),
    ).toBeVisible();
    await page
      .getByLabel("ZKas spending seed (64 hexadecimal characters)")
      .fill("a".repeat(64));
    await page.evaluate(() => {
      (
        window as typeof window & { __seedNode: HTMLInputElement | null }
      ).__seedNode = document.querySelector<HTMLInputElement>("#zkas-seed");
    });
    await page
      .getByRole("button", { name: "Configure ZKas daemon credential" })
      .click();
    expect(
      await page.evaluate(() => {
        const node = (
          window as typeof window & { __seedNode: HTMLInputElement }
        ).__seedNode;
        return { valueEmpty: node.value === "", isConnected: node.isConnected };
      }),
    ).toEqual({ valueEmpty: true, isConnected: false });
    expect(
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __router: { state: { location: { state: unknown } } };
            }
          ).__router.state.location.state,
      ),
    ).toEqual({ pairingReturn: "import-zkas-seed" });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByLabel("ZKas spending seed (64 hexadecimal characters)"),
    ).toHaveValue("");
    await page.evaluate(() => {
      (window as typeof window & { __holdPreview: boolean }).__holdPreview =
        true;
    });
    await page
      .getByLabel("ZKas spending seed (64 hexadecimal characters)")
      .fill("b".repeat(64));
    await page.getByRole("button", { name: "Show derived address" }).click();
    await expect(
      page.getByRole("button", { name: "Configure ZKas daemon credential" }),
    ).toBeDisabled();
    await page.evaluate(() =>
      (
        window as typeof window & { __releasePreview: () => void }
      ).__releasePreview(),
    );
    await expect(
      page.getByRole("button", { name: "Configure ZKas daemon credential" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Configure ZKas daemon credential" })
      .click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByLabel("ZKas spending seed (64 hexadecimal characters)"),
    ).toHaveValue("");
    await expect(page.getByText("dummy-address")).toHaveCount(0);
    await page.evaluate(() =>
      (
        window as typeof window & {
          __router: { navigate: (path: string) => void };
        }
      ).__router.navigate("/zkas/settings"),
    );
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("ZKas asset")).toBeVisible();
    await page.evaluate(() =>
      (
        window as typeof window & {
          __router: { navigate: (path: string, options?: object) => void };
        }
      ).__router.navigate("/zkas/settings", {
        state: { pairingReturn: "https://untrusted.example" },
      }),
    );
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("ZKas asset")).toBeVisible();

    await page.evaluate(() => {
      (
        window as typeof window & { __fixtureExperimental: boolean }
      ).__fixtureExperimental = false;
      (
        window as typeof window & {
          __router: { navigate: (path: string, options?: object) => void };
        }
      ).__router.navigate("/import-private-key", {
        state: { showZKasSeed: true },
      });
    });
    await expect(page.getByPlaceholder("Private key")).toBeVisible();
    await expect(
      page.getByLabel("ZKas spending seed (64 hexadecimal characters)"),
    ).toHaveCount(0);
    await page.evaluate(() =>
      (
        window as typeof window & {
          __router: { navigate: (path: string) => void };
        }
      ).__router.navigate("/add-wallet"),
    );
    await expect(
      page.getByRole("button", { name: "Configure ZKas daemon credential" }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      (
        window as typeof window & {
          __router: { navigate: (path: string) => void };
        }
      ).__router.navigate("/zkas/settings"),
    );
    await expect(page.getByText("Dashboard")).toBeVisible();
    await keyring.lock();
    await page.evaluate(() => {
      (
        window as typeof window & { __fixtureExperimental: boolean }
      ).__fixtureExperimental = true;
      (
        window as typeof window & { __fixtureUnlocked: boolean }
      ).__fixtureUnlocked = false;
      (
        window as typeof window & {
          __router: { navigate: (path: string) => void };
        }
      ).__router.navigate("/zkas/settings");
    });
    await expect(page.getByText("Unlock")).toBeVisible();
  } finally {
    await browser.close();
  }
});
