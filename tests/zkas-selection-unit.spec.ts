import { expect, test } from "@playwright/test";
import type { Settings } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import { getSelectedZKasAccount, getZKasMnemonic, loadSelectedZKasAccount, sameZKasSelection } from "@/lib/zkas/selection";
import { getZKasDaemonOriginPattern } from "@/lib/zkas/client";
import { isTrustedZKasSender } from "@/lib/service/zkas-sender";

const walletSettings = {
  selectedWalletId: "wallet-1",
  selectedAccountIndex: 1,
  lastRecoveryPhraseNumber: 1,
  lastPrivateKeyNumber: 0,
  wallets: [{
    id: "wallet-1",
    name: "Wallet",
    type: "mnemonic" as const,
    backed: true,
    accounts: [{ index: 1, name: "Account 2", address: "kaspa:example" }],
  }],
} satisfies WalletSettings;
const mainnetSettings = { networkId: "mainnet", preview: true, activeChain: "zkas" } as Settings;

test("selected phrase account follows the Kastle wallet and selected ZKas mainnet", () => {
  const mainnet = getSelectedZKasAccount(walletSettings, mainnetSettings, true);
  expect(mainnet).toEqual({ walletId: "wallet-1", accountIndex: 1, network: "mainnet" });
  expect(sameZKasSelection(mainnet, { ...mainnet })).toBe(true);
  expect(sameZKasSelection(mainnet, { ...mainnet, network: "testnet" })).toBe(false);
});

test("ZKas account requests require the experimental toggle and active ZKas network", () => {
  for (const settings of [
    { ...mainnetSettings, preview: false },
    { ...mainnetSettings, activeChain: "kaspa" },
    { ...mainnetSettings, networkId: "testnet-10" },
  ] as Settings[]) {
    expect(() => getSelectedZKasAccount(walletSettings, settings, true)).toThrow(/select ZKas|experimental/i);
  }
  expect(() => getSelectedZKasAccount(walletSettings, mainnetSettings, false)).toThrow(/experimental/i);
});

test("unsupported or absent account secrets fail before derivation", () => {
  const selected = getSelectedZKasAccount(walletSettings, mainnetSettings, true);
  expect(getZKasMnemonic([{ id: "wallet-1", type: "mnemonic", value: "synthetic phrase" }], selected))
    .toBe("synthetic phrase");
  for (const secret of [
    { id: "wallet-1", type: "mnemonic" as const, value: "synthetic phrase", passphrase: "secret" },
    { id: "wallet-1", type: "privateKey" as const, value: "not-a-key" },
    { id: "wallet-1", type: "ledger" as const, value: "ledger" },
  ]) {
    expect(() => getZKasMnemonic([secret], selected)).toThrow(/not supported/i);
  }
  expect(() => getZKasMnemonic([], selected)).toThrow(/not found/i);
  expect(() => getSelectedZKasAccount({ ...walletSettings, selectedAccountIndex: 2 }, mainnetSettings, true))
    .toThrow(/account/i);
});

test("daemon permission pattern matches the selected host and refuses plaintext remote URLs", () => {
  expect(getZKasDaemonOriginPattern("https://daemon.example/path"))
    .toBe("https://daemon.example/*");
  expect(getZKasDaemonOriginPattern("http://127.0.0.1:8080"))
    .toBe("http://127.0.0.1/*");
  expect(() => getZKasDaemonOriginPattern("http://daemon.example"))
    .toThrow(/https/i);
  expect(() => getZKasDaemonOriginPattern("https://user:pass@daemon.example"))
    .toThrow(/credentials/i);
});

test("only messages from the extension origin reach privileged ZKas handlers", () => {
  const id = "extension-id";
  const origin = "chrome-extension://extension-id";
  expect(isTrustedZKasSender({ id, url: `${origin}/popup.html` }, id, origin)).toBe(true);
  for (const sender of [
    { id, url: "https://example.com/" },
    { id, url: "not a URL" },
    { id: "other-id", url: `${origin}/popup.html` },
    { id },
  ]) {
    expect(isTrustedZKasSender(sender, id, origin)).toBe(false);
  }
});

test("lock or unlock during asynchronous selection reads invalidates the request", async () => {
  for (const unlockedAgain of [false, true]) {
    let finishRead!: (value: WalletSettings) => void;
    const pendingSettings = new Promise<WalletSettings>((resolve) => { finishRead = resolve; });
    let unlocked = true;
    let version = 1;
    const keyring = { isUnlocked: () => unlocked, getSessionVersion: () => version };
    const selected = loadSelectedZKasAccount(keyring, () => pendingSettings, async () => mainnetSettings, async () => true);
    unlocked = false;
    version += 1;
    if (unlockedAgain) { unlocked = true; version += 1; }
    finishRead(walletSettings);
    await expect(selected).rejects.toThrow(/locked/i);
  }
});
