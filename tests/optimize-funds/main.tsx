import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import init, { PrivateKey, PublicKey } from "@/wasm/core/kaspa";
import wasmUrl from "@/assets/kaspa_bg.wasm?url";
import OptimizeFunds from "@/components/screens/full-pages/OptimizeFunds";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import {
  getState,
  harnessAccount,
  initStore,
  MNEMONIC,
  OTHER_MNEMONIC,
  update,
  type HarnessState,
} from "./stubs";

declare global {
  interface Window {
    __optimize: {
      addresses: Record<"A" | "B" | "L" | "S", string>;
      // the hot signer hook of the latest render
      hotSigner: () => ReturnType<typeof useKaspaHotWalletSigner>;
      state: () => HarnessState;
      update: (patch: Partial<HarnessState>) => void;
    };
  }
}

const KEYS = {
  A: "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef",
  B: "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9",
};

function Failed() {
  const { state } = useLocation();
  const error = state?.error as Error | undefined;
  if (!getState().failed) {
    getState().failed = { errorName: error?.name, report: state?.report };
  }
  return <h2>Optimize failed stub</h2>;
}

let hotSigner: ReturnType<typeof useKaspaHotWalletSigner>;
function HotSignerProbe() {
  hotSigner = useKaspaHotWalletSigner();
  return null;
}

function Succeeded() {
  getState().succeeded = true;
  return <h2>Optimize succeeded stub</h2>;
}

(async () => {
  await init({ module_or_path: wasmUrl });
  (globalThis as { browser?: unknown }).browser = {
    runtime: { getManifest: () => ({ version: "0.0.0-harness" }) },
  };
  const addresses = {
    A: new PrivateKey(KEYS.A).toPublicKey().toAddress("mainnet").toString(),
    B: new PrivateKey(KEYS.B).toPublicKey().toAddress("mainnet").toString(),
    // the legacy key of account 1 of the harness recovery phrase
    L: harnessAccount(true, 1).getPublicKey().toAddress("mainnet").toString(),
    S: new PublicKey(harnessAccount(true, 1).getPublicKeys()[1])
      .toAddress("mainnet")
      .toString(),
  };
  const q = new URLSearchParams(location.search);
  const pick = (name: string) => {
    const v = q.get(name);
    return v === "A" || v === "B" || v === "L" ? addresses[v] : undefined;
  };
  initStore({
    accountAddress: pick("account") ?? addresses.A,
    accountIndex: Number(q.get("index") ?? 1),
    isLegacy: q.get("legacy") === "1",
    signerAddress:
      q.get("signer") === "none"
        ? undefined
        : q.get("signer") === "fail"
          ? addresses.A
          : pick("signer"),
    signerFails: q.get("signer") === "fail",
    isLedger: q.get("ledger") === "1",
    // A: 200 entries (3 transactions), B: 250 (4 transactions), L: 81 (1);
    // entries=N overrides A
    entryCounts: {
      [addresses.A]: Number(q.get("entries") ?? 200),
      [addresses.B]: 250,
      [addresses.L]: 81,
    },
    utxoQuery: (q.get("utxo") ?? undefined) as HarnessState["utxoQuery"],
    calls: { getAddress: 0, signTx: 0, submit: 0, revalidate: 0 },
    signedIsLegacy: [],
    isLegacyBy: {},
    seedPhrase: q.get("seed") === "other" ? OTHER_MNEMONIC : MNEMONIC,
    submitFails: q.get("submit") === "fail",
    preFix: q.get("prefix") === "1",
    wallet: q.get("wallet") === "fragmented" ? "fragmented" : "default",
    siblingAddress: addresses.S,
    ledgerLog: [],
    guards: [],
    plans: [],
    rounds: [],
    submitted: [],
  });
  window.__optimize = {
    addresses,
    state: getState,
    update,
    hotSigner: () => hotSigner,
  };

  const router = createMemoryRouter(
    [
      { path: "/optimize-funds", element: <OptimizeFunds /> },
      { path: "/token-operation-failed", element: <Failed /> },
      { path: "/token-operation-success", element: <Succeeded /> },
    ],
    {
      initialEntries: [
        {
          pathname: "/optimize-funds",
          // spent=all: a Retry from the incomplete screen whose previous
          // round already spent every one of A's entries (stubs.tsx `entry`)
          state:
            q.get("spent") === "all"
              ? {
                  spentOutpoints: Array.from(
                    { length: Number(q.get("entries") ?? 200) },
                    (_, i) => `${(i + 1).toString(16).padStart(64, "0")}:0`,
                  ),
                }
              : undefined,
        },
      ],
    },
  );
  createRoot(document.getElementById("root")!).render(
    <>
      <HotSignerProbe />
      <RouterProvider router={router} />
    </>,
  );
})();
