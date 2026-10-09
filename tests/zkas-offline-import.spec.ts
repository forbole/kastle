import { chromium, expect, test } from "@playwright/test";
import { build, stop } from "esbuild";
import { Keyring } from "@/lib/keyring-manager";

const dummySeed = "a".repeat(64);
const dummyMnemonic = `${Array(11).fill("abandon").join(" ")} about`;

async function importBundle() {
  const root = process.cwd();
  const mocks: Record<string, string> = {
    "@/components/GeneralHeader":
      "export default function Header(){return null;}",
    "@/components/Toast":
      "export default {info(message,onClick){window.__pendingNotice={message,onClick};},error(message){window.__pendingNotice={message};}};",
    "@/hooks/useAnalytics":
      "export default function useAnalytics(){return {emitWalletCreated(){}};}",
    "@/hooks/useKeyring":
      "export default function useKeyring(){return {keyringInitialize:(password)=>window.__initialize(password)};}",
    "@/hooks/wallet/useWalletImporter":
      "export default function useWalletImporter(){return {importWalletByMnemonic:(...args)=>window.__importMnemonic(...args)};}",
    "@/hooks/useSettings":
      "export const useSettings=()=>[window.__fixtureSettings,null,false];",
    "@/hooks/useStorageState":
      "export default function useStorageState(){return [true,null,false];}",
    "@/hooks/useSwitchNetwork":
      "export default function useSwitchNetwork(){return {switchZKasNetwork:async()=>{}};}",
    "@/lib/wallet-network":
      "export const ZKAS_EXPERIMENTAL_KEY='local:zkas-experimental-enabled'; export const isZKasActive=(settings,enabled)=>settings?.preview===true&&enabled!==false&&settings.activeChain==='zkas'&&settings.networkId==='mainnet';",
    "@/lib/zkas/setup":
      "export const requireZKasDaemonUrl=(settings)=>{const value=settings?.zkasDaemonUrls?.mainnet?.trim();if(!value)throw new Error('Add a ZKas wallet daemon');return value;};",
    "@/lib/zkas/popup-client":
      "export const getZKasDaemonBirthday=()=>window.__birthday(); export const previewZKasSeed=(seed)=>window.__preview(seed); export const importZKasSeed=(seed,expected)=>window.__importSeed(seed,expected); export const registerSelectedZKasWallet=(account,origin,birthday)=>window.__register(account,origin,birthday);",
    "@/wasm/core/kaspa": "export class Mnemonic{constructor() {}}",
    "@/lib/wallet/wasm-lifecycle": "export const withOwned=(fn)=>fn(x=>x);",
    "react-hook-form": `
      const words=Object.fromEntries(Array.from({length:12},(_,i)=>['word'+(i+1),i===11?'about':'abandon']));
      export const useFormContext=()=>({getValues:()=> 'dummy-password'});
      export const useForm=()=>({
        register:()=>({}),
        formState:{isValid:true,dirtyFields:{}},
        watch:()=>words,
        setValue:()=>{},
        reset:()=>{},
        handleSubmit:(action)=>(event)=>{event.preventDefault();return action(words);}
      });
    `,
  };
  const result = await build({
    stdin: {
      contents: `
        import {createRoot} from 'react-dom/client';
        import {createMemoryRouter,RouterProvider} from 'react-router-dom';
        import Recovery from './components/screens/full-pages/ImportRecoveryPhrase';
        import Seed from './components/screens/full-pages/ImportZKasSeed';
        const router=createMemoryRouter([
          {path:'/recovery',element:<Recovery/>},
          {path:'/seed',element:<Seed onBack={()=>{}}/>},
          {path:'/accounts-imported',element:<p>Accounts imported</p>},
          {path:'/manage-accounts/recovery-phrase/:walletId/import',element:<p>Manage imported wallet</p>},
          {path:'/zkas/settings',element:<p>ZKas settings</p>}
        ],{initialEntries:[window.__importRoute]});
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
        name: "offline-import-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /^@\// }, (args) => {
            const key = args.path.replace(/\.(tsx?|jsx?)$/, "");
            const mocked = Object.keys(mocks).find(
              (candidate) => candidate.replace(/\.(tsx?|jsx?)$/, "") === key,
            );
            return mocked
              ? { path: mocked, namespace: "offline-mock" }
              : undefined;
          });
          plugin.onResolve({ filter: /^react-hook-form$/ }, () => ({
            path: "react-hook-form",
            namespace: "offline-mock",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "offline-mock" },
            (args) => ({
              contents: mocks[args.path],
              loader: "tsx",
              resolveDir: root,
            }),
          );
        },
      },
    ],
  });
  stop();
  return result.outputFiles[0].text;
}

async function fixture(route: "/recovery" | "/seed", daemonUrl?: string) {
  const entries = new Map<string, unknown>();
  Object.assign(globalThis, {
    storage: {
      getItem: async (key: string) => entries.get(key) ?? null,
      setItem: async (key: string, value: unknown) => entries.set(key, value),
      removeItem: async (key: string) => entries.delete(key),
    },
  });
  const keyring = new Keyring(`offline-import-${crypto.randomUUID()}`);
  if (route === "/seed") await keyring.initialize("dummy-password");
  const calls: string[] = [];
  let registrationFailure: string | undefined;
  const bundle = await importBundle();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.KASTLE_TEST_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage();
  await page.exposeFunction("__initialize", async (password: string) => {
    calls.push("initialize");
    await keyring.initialize(password);
  });
  await page.exposeFunction(
    "__importMnemonic",
    async (_id: string, phrase: string) => {
      calls.push("import-mnemonic");
      expect(phrase).toBe(dummyMnemonic);
      await keyring.updateValue("wallets", (current: unknown) => [
        ...((current as object[]) ?? []),
        { kind: "mnemonic", accountIndex: 0 },
      ]);
      return "dummy-kaspa-address";
    },
  );
  await page.exposeFunction("__preview", async (seed: string) => {
    expect(seed).toBe(dummySeed);
    return { network: "mainnet", address: "dummy-zkas-address" };
  });
  await page.exposeFunction(
    "__importSeed",
    async (seed: string, expected: { address: string }) => {
      calls.push("import-seed");
      expect(seed).toBe(dummySeed);
      expect(expected.address).toBe("dummy-zkas-address");
      await keyring.updateValue("wallets", (current: unknown) => [
        ...((current as object[]) ?? []),
        { kind: "zkas-seed", accountIndex: 0, address: expected.address },
      ]);
      return {
        walletId: "dummy-wallet",
        accountIndex: 0,
        network: "mainnet",
        address: expected.address,
      };
    },
  );
  await page.exposeFunction("__birthday", async () => {
    calls.push("birthday");
    throw new Error("Daemon unavailable");
  });
  await page.exposeFunction(
    "__register",
    async (
      account: {
        walletId: string;
        accountIndex: number;
        network: string;
        address?: string;
      },
      origin: string,
      birthday?: number,
    ) => {
      expect(account.accountIndex).toBe(0);
      expect(account.network).toBe("mainnet");
      expect(account.walletId).toBeTruthy();
      if (route === "/seed") expect(account.address).toBe("dummy-zkas-address");
      calls.push(`register:${origin}:${birthday ?? "default"}`);
      if (registrationFailure) throw new Error(registrationFailure);
    },
  );
  await page.addInitScript(
    ({ route, daemonUrl }) => {
      Object.assign(window, {
        __importRoute: route,
        __fixtureSettings: {
          preview: true,
          activeChain: "zkas",
          networkId: "mainnet",
          zkasDaemonUrls: daemonUrl ? { mainnet: daemonUrl } : {},
        },
      });
    },
    { route, daemonUrl },
  );
  await page.route("**/*", async (request) => {
    if (new URL(request.request().url()).pathname === "/app.js")
      await request.fulfill({ contentType: "text/javascript", body: bundle });
    else
      await request.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div><script src="/app.js"></script>',
      });
  });
  await page.goto("https://dummy-offline-import.invalid/");
  return {
    page,
    keyring,
    calls,
    failRegistration(reason: string) {
      registrationFailure = reason;
    },
    async close() {
      await browser.close();
    },
  };
}

test("first mnemonic import saves locally without a daemon and offers pending registration", async () => {
  const flow = await fixture("/recovery");
  try {
    await flow.page.getByRole("button", { name: "Import Wallet" }).click();
    await expect(flow.page.getByText("Manage imported wallet")).toBeVisible();
    expect(flow.calls).toEqual(["initialize", "import-mnemonic"]);
    expect(await flow.keyring.getValue<object[]>("wallets")).toMatchObject([
      { kind: "mnemonic" },
    ]);
    const pending = await flow.page.evaluate(
      () =>
        (window as typeof window & { __pendingNotice?: { message: string } })
          .__pendingNotice?.message,
    );
    expect(pending).toMatch(/registration pending/i);
    await flow.page.evaluate(() =>
      (
        window as typeof window & { __pendingNotice: { onClick: () => void } }
      ).__pendingNotice.onClick(),
    );
    await expect(flow.page.getByText("ZKas settings")).toBeVisible();
  } finally {
    await flow.close();
  }
});

test("seed import retains exact preview identity when daemon registration is unauthorized", async () => {
  const flow = await fixture("/seed", "https://daemon.example");
  flow.failRegistration("Unauthorized");
  try {
    await flow.page
      .getByLabel("ZKas spending seed (64 hexadecimal characters)")
      .fill(dummySeed);
    await flow.page
      .getByRole("button", { name: "Show derived address" })
      .click();
    await expect(flow.page.getByText("dummy-zkas-address")).toBeVisible();
    await flow.page
      .getByRole("button", { name: "Import this ZKas seed" })
      .click();
    await expect(flow.page.getByText("Accounts imported")).toBeVisible();
    expect(flow.calls).toEqual([
      "import-seed",
      "register:https://daemon.example:0",
    ]);
    expect(await flow.keyring.getValue<object[]>("wallets")).toMatchObject([
      { kind: "zkas-seed", address: "dummy-zkas-address" },
    ]);
    const pending = await flow.page.evaluate(
      () =>
        (window as typeof window & { __pendingNotice?: { message: string } })
          .__pendingNotice?.message,
    );
    expect(pending).toMatch(/registration pending/i);
  } finally {
    await flow.close();
  }
});

test("configured mnemonic import registers from genesis after the encrypted local save", async () => {
  const flow = await fixture("/recovery", "https://daemon.example");
  try {
    await flow.page.getByRole("button", { name: "Import Wallet" }).click();
    await expect(flow.page.getByText("Manage imported wallet")).toBeVisible();
    expect(flow.calls).toEqual([
      "initialize",
      "import-mnemonic",
      "register:https://daemon.example:0",
    ]);
    expect(await flow.keyring.getValue<object[]>("wallets")).toMatchObject([
      { kind: "mnemonic", accountIndex: 0 },
    ]);
    expect(
      await flow.page.evaluate(
        () =>
          (window as typeof window & { __pendingNotice?: unknown })
            .__pendingNotice,
      ),
    ).toBeUndefined();
  } finally {
    await flow.close();
  }
});

test("seed import saves locally when daemon configuration is missing", async () => {
  const flow = await fixture("/seed");
  try {
    await flow.page
      .getByLabel("ZKas spending seed (64 hexadecimal characters)")
      .fill(dummySeed);
    await flow.page
      .getByRole("button", { name: "Show derived address" })
      .click();
    await expect(flow.page.getByText("dummy-zkas-address")).toBeVisible();
    await flow.page
      .getByRole("button", { name: "Import this ZKas seed" })
      .click();
    await expect(flow.page.getByText("Accounts imported")).toBeVisible();
    expect(flow.calls).toEqual(["import-seed"]);
    expect(await flow.keyring.getValue<object[]>("wallets")).toMatchObject([
      { kind: "zkas-seed", accountIndex: 0, address: "dummy-zkas-address" },
    ]);
    const pending = await flow.page.evaluate(
      () =>
        (window as typeof window & { __pendingNotice?: { message: string } })
          .__pendingNotice?.message,
    );
    expect(pending).toMatch(/registration pending/i);
  } finally {
    await flow.close();
  }
});

test("a changed account rejected by registration stays saved but pending", async () => {
  const flow = await fixture("/seed", "https://daemon.example");
  flow.failRegistration("Selected account changed");
  try {
    await flow.page
      .getByLabel("ZKas spending seed (64 hexadecimal characters)")
      .fill(dummySeed);
    await flow.page
      .getByRole("button", { name: "Show derived address" })
      .click();
    await expect(flow.page.getByText("dummy-zkas-address")).toBeVisible();
    await flow.page
      .getByRole("button", { name: "Import this ZKas seed" })
      .click();
    await expect(flow.page.getByText("Accounts imported")).toBeVisible();
    expect(flow.calls).toEqual([
      "import-seed",
      "register:https://daemon.example:0",
    ]);
    expect(await flow.keyring.getValue<object[]>("wallets")).toMatchObject([
      { kind: "zkas-seed", address: "dummy-zkas-address" },
    ]);
    const pending = await flow.page.evaluate(
      () =>
        (window as typeof window & { __pendingNotice?: { message: string } })
          .__pendingNotice?.message,
    );
    expect(pending).toMatch(/registration pending/i);
  } finally {
    await flow.close();
  }
});
