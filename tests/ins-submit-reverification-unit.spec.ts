import { registerHooks } from "node:module";
import { test, expect, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { numberToHex } from "viem";

// lib/layer2 imports chain logos; Node cannot parse an .svg, so stub each one
// as its own path before the modules under test load.
registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".svg")) return next(url, context);
    return {
      format: "commonjs",
      source: `module.exports = ${JSON.stringify(url)};`,
      shortCircuit: true,
    };
  },
});

const { lookupInsNameOnChain } = await import("@/lib/ins/insRegistry");
const { igraMainnet, igraTestnet } = await import("@/lib/layer2");

const MAINNET = numberToHex(igraMainnet.id);
const NAME = "alice.igra";
const OLD_OWNER = "0x000000000000000000000000000000000000a11c";
const NEW_OWNER = "0x000000000000000000000000000000000000b0b0";
const TOKEN = "0x00000000000000000000000000000000000070c0";

const REPOINTED =
  "This name now points to a different address. Go back and check the recipient.";
const STALE =
  "This name was checked over a minute ago. Go back to check it again.";
const LOOKUP_FAILED = "Could not verify this name on-chain. Try again.";
const VERIFIED = "Verified on-chain owner";

test("a chainId without an INS registry returns ok:false and makes no RPC call", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    throw new Error("offline");
  }) as typeof fetch;

  try {
    const testnet = await lookupInsNameOnChain(
      NAME,
      numberToHex(igraTestnet.id),
    );
    expect(testnet.ok).toBe(false);
    expect(calls).toEqual([]);

    // Control: mainnet still reads its own registry RPC (offline here, so it
    // fails closed too -- but only after trying).
    expect((await lookupInsNameOnChain(NAME, MAINNET)).ok).toBe(false);
    expect(calls[0]).toContain(
      new URL(igraMainnet.rpcUrls.default.http[0]).host,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The real native and token Confirm steps, bundled with their data hooks
// stubbed. The on-chain lookup returns window.__onChain, and the signer only
// records what it would have sent (window.__sent), so nothing reaches the
// network.

const repo = path.resolve(import.meta.dirname, "..");

const STUBS: Record<string, string> = {
  // A stub may re-export the module it shadows; its own import resolves to
  // the real one.
  viem: `export * from "viem";
    export const createPublicClient = () => ({ estimateGas: async () => 21000n });`,
  "lib/ins/insRegistry": `export * from "@/lib/ins/insRegistry";
    export const lookupInsNameOnChain = async (name, chainId) => {
      window.__lookups.push([name, chainId]);
      return window.__onChain;
    };`,
  "lib/ethereum/transaction": `export const sendEvmTransaction = async (tx) => {
    window.__sent.push({ to: tx.to, data: tx.data ?? null });
    return "0xtx";
  };`,
  "lib/utils": `export const formatUsdAmount = () => "";
    export const formatToken = (n) => String(n);`,
  "hooks/useKaspaPrice": `export default () => ({ kaspaPrice: 0 });`,
  "hooks/useCurrencyValue": `export default (v) => ({ amount: v, code: "USD" });`,
  "hooks/useAnalytics": `export default () => ({ emitFirstTransaction: async () => {} });`,
  "hooks/wallet/useWalletManager": `export default () => ({ wallet: { type: "mnemonic" } });`,
  "hooks/evm/useEvmAddress": `export default () => "0x1111111111111111111111111111111111111111";`,
  "hooks/evm/useFeeEstimate": `export default () => ({ data: 0n });`,
  "hooks/evm/useZealousSwapMetadata": `export const useErc20Price = () => ({ price: 0 });`,
};

const stubs: Plugin = {
  name: "ins-confirm-stubs",
  setup(b) {
    b.onResolve({ filter: /^(@\/|viem$)/ }, (args) => {
      if (args.namespace === "stub") return undefined;
      const rel = args.path.replace(/^@\//, "").replace(/\.(tsx?)$/, "");
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
      resolveDir: repo,
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
        import { FormProvider, useForm } from "react-hook-form";
        import { ConfirmStep as NativeConfirm } from "@/components/send/evm/evm-kas-send/ConfirmStep";
        import { ConfirmStep as TokenConfirm } from "@/components/send/evm/erc20-send/ConfirmStep";
        function Harness() {
          const form = useForm({ defaultValues: window.__form });
          const props = {
            onNext() {}, onBack() {}, onFail() {}, setOutTxs() {},
            walletSigner: { getAddress: async () => "0x1111111111111111111111111111111111111111" },
          };
          return (
            <FormProvider {...form}>
              {window.__flow === "token"
                ? <TokenConfirm asset={window.__asset} {...props} />
                : <NativeConfirm chainId={window.__chainId} {...props} />}
            </FormProvider>
          );
        }
        createRoot(document.getElementById("root")).render(
          <MemoryRouter><Harness /></MemoryRouter>,
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

type Flow = "native" | "token";

// What the Details step leaves in the form after resolving NAME on-chain.
const resolvedForm = (resolvedAt = Date.now()) => ({
  userInput: NAME,
  address: OLD_OWNER,
  domain: NAME,
  resolvedFor: "alice",
  resolvedAt,
  amount: "1",
});

async function mount(
  page: Page,
  opts: {
    flow: Flow;
    form: Record<string, unknown>;
    onChain?: Record<string, unknown>;
  },
) {
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(
    (o) => {
      Object.assign(window, {
        __flow: o.flow,
        __form: o.form,
        __onChain: o.onChain,
        __chainId: o.chainId,
        __asset: {
          address: o.token,
          chainId: o.chainId,
          decimals: 18,
          symbol: "TKN",
        },
        __sent: [],
        __lookups: [],
      });
    },
    { ...opts, chainId: MAINNET, token: TOKEN },
  );
  await page.addScriptTag({ content: bundle });
}

const read = (page: Page, key: "__sent" | "__lookups") =>
  page.evaluate(
    (k) => (window as unknown as Record<string, unknown[]>)[k],
    key,
  );

const confirm = (page: Page) =>
  page.getByRole("button", { name: "Confirm" }).click();

for (const flow of ["native", "token"] as const) {
  test(`${flow}: a name re-pointed between Details and Confirm blocks the send`, async ({
    page,
  }) => {
    await mount(page, {
      flow,
      form: resolvedForm(),
      onChain: { ok: true, address: NEW_OWNER },
    });
    await confirm(page);
    await expect(page.getByText(REPOINTED)).toBeVisible();
    expect(await read(page, "__sent")).toEqual([]);
    expect(await read(page, "__lookups")).toContainEqual([NAME, MAINNET]);
  });

  test(`${flow}: a resolved address older than the TTL blocks the send`, async ({
    page,
  }) => {
    // The chain still agrees: age alone has to block.
    await mount(page, {
      flow,
      form: resolvedForm(Date.now() - 61_000),
      onChain: { ok: true, address: OLD_OWNER },
    });
    await confirm(page);
    await expect(page.getByText(STALE)).toBeVisible();
    expect(await read(page, "__sent")).toEqual([]);
  });

  test(`${flow}: a failed lookup blocks the send instead of using the stored address`, async ({
    page,
  }) => {
    await mount(page, {
      flow,
      form: resolvedForm(),
      onChain: { ok: false, reason: LOOKUP_FAILED },
    });
    await confirm(page);
    await expect(page.getByText(LOOKUP_FAILED)).toBeVisible();
    expect(await read(page, "__sent")).toEqual([]);
    expect((await read(page, "__lookups")).length).toBeGreaterThan(0);
  });

  test(`${flow}: the confirm screen shows the name with its verified address, then sends`, async ({
    page,
  }) => {
    await mount(page, {
      flow,
      form: resolvedForm(),
      onChain: { ok: true, address: OLD_OWNER },
    });
    await expect(page.getByText(`${NAME} → ${OLD_OWNER}`)).toBeVisible();
    await expect(page.getByText(VERIFIED)).toBeVisible();
    await confirm(page);
    await expect.poll(() => read(page, "__sent")).toHaveLength(1);
    const [sent] = (await read(page, "__sent")) as {
      to: string;
      data: string | null;
    }[];
    if (flow === "native") {
      expect(sent.to).toBe(OLD_OWNER);
    } else {
      expect(sent.to).toBe(TOKEN);
      expect(sent.data).toContain(OLD_OWNER.slice(2));
    }
  });
}

test("native: a pasted address sends without any name lookup", async ({
  page,
}) => {
  await mount(page, {
    flow: "native",
    form: { userInput: OLD_OWNER, address: OLD_OWNER, amount: "1" },
  });
  await confirm(page);
  await expect.poll(() => read(page, "__sent")).toHaveLength(1);
  expect(await read(page, "__lookups")).toEqual([]);
});
