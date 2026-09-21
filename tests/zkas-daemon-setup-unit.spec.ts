import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Settings } from "@/contexts/SettingsContext";
import {
  requireZKasDaemonUrl,
  selectZKasNetworkWithDaemon,
} from "@/lib/zkas/setup";

const root = process.cwd();

test("ZKas wallet creation requires a configured daemon", () => {
  const settings = {
    networkId: "mainnet",
    preview: true,
    activeChain: "zkas",
  } as Settings;
  expect(() => requireZKasDaemonUrl(settings, "mainnet")).toThrow(
    /add a ZKas wallet daemon/i,
  );
  expect(
    requireZKasDaemonUrl(
      {
        ...settings,
        zkasDaemonUrls: { mainnet: "https://daemon.example" },
      },
      "mainnet",
    ),
  ).toBe("https://daemon.example");
});

test("ZKas selection rechecks the current settings snapshot for a daemon", () => {
  const staleWindow = {
    networkId: "mainnet",
    preview: true,
    activeChain: "kaspa",
    zkasDaemonUrls: { mainnet: "https://old.example" },
  } as Settings;
  const currentStorage = { ...staleWindow, zkasDaemonUrls: {} };
  expect(() => selectZKasNetworkWithDaemon(currentStorage, true)).toThrow(
    /add a ZKas wallet daemon/i,
  );
  expect(
    selectZKasNetworkWithDaemon(currentStorage, true, "https://new.example"),
  ).toMatchObject({
    activeChain: "zkas",
    zkasDaemonUrls: { mainnet: "https://new.example" },
  });
});

test("experimental setup, wallet creation, and imports wire daemon registration", () => {
  const devMode = fs.readFileSync(
    path.join(root, "components/screens/DevMode.tsx"),
    "utf8",
  );
  const settingsPage = fs.readFileSync(
    path.join(root, "components/screens/zkas/ZKasSettings.tsx"),
    "utf8",
  );
  const addWallet = fs.readFileSync(
    path.join(root, "components/screens/AddWallet.tsx"),
    "utf8",
  );
  const importPhrase = fs.readFileSync(
    path.join(root, "components/screens/full-pages/ImportRecoveryPhrase.tsx"),
    "utf8",
  );
  const importSeed = fs.readFileSync(
    path.join(root, "components/screens/full-pages/ImportZKasSeed.tsx"),
    "utf8",
  );
  const keyService = fs.readFileSync(
    path.join(root, "lib/zkas/key-service.ts"),
    "utf8",
  );
  const networkSwitch = fs.readFileSync(
    path.join(root, "hooks/useSwitchNetwork.ts"),
    "utf8",
  );
  const popupClient = fs.readFileSync(
    path.join(root, "lib/zkas/popup-client.ts"),
    "utf8",
  );
  const walletManager = fs.readFileSync(
    path.join(root, "contexts/WalletManagerContext.tsx"),
    "utf8",
  );
  expect(devMode).toContain('navigate("/zkas/settings")');
  expect(settingsPage).toContain("registerSelectedZKasWallet");
  expect(settingsPage).toContain("switchZKasNetwork(daemonUrl");
  expect(settingsPage.indexOf("browser.permissions.request")).toBeLessThan(
    settingsPage.indexOf("getSelectedZKasAddress()"),
  );
  expect(settingsPage).toContain("withWalletSettingsLock");
  expect(settingsPage.indexOf("withWalletSettingsLock")).toBeLessThan(
    settingsPage.indexOf("switchZKasNetwork(daemonUrl"),
  );
  expect(settingsPage).toContain("deferKaspaAddressRefresh: true");
  expect(settingsPage.indexOf("await refreshKaspaAddresses(")).toBeGreaterThan(
    settingsPage.indexOf("withWalletSettingsLock"),
  );
  expect(settingsPage).toContain("if (setupFailed) throw setupFailure");
  expect(settingsPage).toMatch(/history and balance/i);
  expect(addWallet).toContain("getZKasDaemonBirthday");
  expect(addWallet).toContain("registerSelectedZKasWallet");
  expect(addWallet).toMatch(/registerSelectedZKasWallet\([\s\S]*birthday/);
  expect(importPhrase).toContain("registerSelectedZKasWallet");
  expect(importPhrase).toContain("Unable to connect to the ZKas daemon");
  expect(importSeed).toContain("registerSelectedZKasWallet");
  expect(popupClient).toContain("expectedDaemonUrl");
  expect(popupClient).toMatch(
    /credentials\.daemonUrl\s*!==\s*expectedDaemonUrl/,
  );
  expect(keyService).not.toContain("zkasBirthday");
  expect(popupClient).toContain("birthday = 0");
  expect(popupClient).not.toContain("credentials.birthday");
  expect(networkSwitch).toContain("refreshKaspaAddresses(NetworkType.Mainnet)");
  expect(walletManager).toContain("storage.getItem<Settings>(SETTINGS_KEY)");
  expect(walletManager).toContain("latestSettings?.networkId ?? networkId");
});
