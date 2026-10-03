import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Settings } from "@/contexts/SettingsContext";
import {
  hasConfiguredZKasDaemon,
  requireZKasDaemonUrl,
  selectZKasNetworkWithSources,
  selectZKasNetworkWithDaemon,
} from "@/lib/zkas/setup";
import { effectiveZKasSource } from "@/lib/zkas/history-config";

const root = process.cwd();

test("ZKas wallet creation still requires explicit daemon setup", () => {
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

test("a default endpoint does not count as first-use daemon approval", () => {
  expect(hasConfiguredZKasDaemon({} as Settings)).toBe(false);
  expect(
    hasConfiguredZKasDaemon({
      zkasDaemonUrls: { mainnet: "https://zkwd.mooncake.space" },
    } as Settings),
  ).toBe(true);
  expect(
    hasConfiguredZKasDaemon({
      zkasDaemonUrls: { mainnet: "" },
    } as Settings),
  ).toBe(false);
  expect(
    hasConfiguredZKasDaemon({
      zkasDaemonUrls: { mainnet: "http://remote.example" },
    } as Settings),
  ).toBe(false);
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

test("effective source is stable across migration and changes with either explicit override", () => {
  const legacy = { networkId: "mainnet" } as Settings;
  const migrated = {
    ...legacy,
    zkasDaemonUrls: { mainnet: "https://zkwd.mooncake.space" },
    zkasHistoryIndexUrls: { mainnet: "https://matjam.mooncake.space" },
  } as Settings;
  expect(effectiveZKasSource(legacy)).toEqual(effectiveZKasSource(migrated));
  expect(
    effectiveZKasSource({
      ...legacy,
      zkasDaemonUrls: { mainnet: "https://other.example" },
    } as Settings),
  ).not.toEqual(effectiveZKasSource(legacy));
  expect(
    effectiveZKasSource({
      ...legacy,
      zkasHistoryIndexUrls: { mainnet: "https://other.example" },
    } as Settings),
  ).not.toEqual(effectiveZKasSource(legacy));
  expect(() =>
    effectiveZKasSource({
      ...legacy,
      zkasDaemonUrls: { mainnet: "" },
    } as Settings),
  ).toThrow();
});

test("stale daemon save cannot replace a changed custom endpoint", () => {
  const earlier = {
    networkId: "mainnet",
    preview: true,
    activeChain: "kaspa",
    zkasDaemonUrls: { mainnet: "https://earlier.example" },
  } as Settings;
  const latest = {
    ...earlier,
    zkasDaemonUrls: { mainnet: "https://latest.example" },
  };
  expect(() =>
    selectZKasNetworkWithDaemon(
      latest,
      true,
      "https://new.example",
      earlier.zkasDaemonUrls?.mainnet,
    ),
  ).toThrow(/changed in another window/i);
});

test("Connect writes both selected origins together and rejects a stale index", () => {
  const settings = {
    networkId: "mainnet",
    preview: true,
    activeChain: "kaspa",
    zkasDaemonUrls: { mainnet: "https://old-daemon.example" },
    zkasHistoryIndexUrls: { mainnet: "https://old-index.example" },
  } as Settings;
  const selected = {
    daemonUrl: "https://new-daemon.example",
    indexUrl: "https://new-index.example",
    expectedDaemon: "https://old-daemon.example",
    expectedIndex: "https://old-index.example",
  };
  expect(selectZKasNetworkWithSources(settings, true, selected)).toMatchObject({
    activeChain: "zkas",
    zkasDaemonUrls: { mainnet: selected.daemonUrl },
    zkasHistoryIndexUrls: { mainnet: selected.indexUrl },
  });
  expect(() =>
    selectZKasNetworkWithSources(
      {
        ...settings,
        zkasHistoryIndexUrls: { mainnet: "https://another-index.example" },
      },
      true,
      selected,
    ),
  ).toThrow(/changed in another window/i);
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
  const privateTransport = fs.readFileSync(
    path.join(root, "lib/service/handlers/zkas-daemon-transport.ts"),
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
  expect(importSeed).toContain("registerSelectedZKasWallet");
  expect(popupClient).toContain("Method.ZKAS_DAEMON_REGISTER");
  expect(privateTransport).toContain(
    "origin !== canonicalDaemonBearerOrigin(expectedOrigin)",
  );
  expect(keyService).not.toContain("zkasBirthday");
  expect(popupClient).toContain("birthday = 0");
  expect(popupClient).not.toContain("credentials.birthday");
  expect(networkSwitch).toContain("refreshKaspaAddresses(NetworkType.Mainnet)");
  expect(walletManager).toContain("storage.getItem<Settings>(SETTINGS_KEY)");
  expect(walletManager).toContain("latestSettings?.networkId ?? networkId");
});
