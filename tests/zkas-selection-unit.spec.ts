import { expect, test } from "@playwright/test";
import type { Settings } from "@/contexts/SettingsContext";
import type { WalletSettings } from "@/contexts/WalletManagerContext";
import { addOrRecoverZKasSeed, assertUniqueZKasSeed, attachZKasSeed, getSelectedAvailableZKasAddress, getSelectedZKasAccount, getZKasMnemonic, getZKasSecretSource, listZKasSwitchAccounts, loadSelectedZKasAccount, requireSelectedZKasAddress, sameZKasSelection } from "@/lib/zkas/selection";
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

test("an explicitly attached ZKas seed enables only the selected imported-key account", () => {
  const imported = {
    ...walletSettings,
    wallets: [{ ...walletSettings.wallets[0], type: "privateKey" as const,
      accounts: [{ index: 0, name: "Imported key", address: "kaspa:example" }] }],
    selectedAccountIndex: 0,
  };
  const selected = getSelectedZKasAccount(imported, mainnetSettings, true);
  const seed = "01".repeat(32);
  const secrets = attachZKasSeed([
    { id: "wallet-1", type: "privateKey", value: "02".repeat(32) },
  ], selected, seed);
  expect(getZKasSecretSource(secrets, selected)).toEqual({ type: "seed", value: seed });
  expect(secrets[0].value).toBe("02".repeat(32));
  expect(() => attachZKasSeed(secrets, selected, "03".repeat(32))).toThrow(/already/i);
  expect(() => getZKasSecretSource(secrets, { ...selected, accountIndex: 1 })).toThrow(/account/i);
});

test("a Kaspa private key is never silently treated as a ZKas seed", () => {
  const selected = { walletId: "wallet-1", accountIndex: 0, network: "mainnet" as const };
  expect(() => getZKasSecretSource([
    { id: "wallet-1", type: "privateKey", value: "01".repeat(32) },
  ], selected)).toThrow(/not supported|import/i);
  expect(() => attachZKasSeed([
    { id: "wallet-1", type: "privateKey", value: "02".repeat(32) },
  ], selected, "not-a-seed")).toThrow(/seed/i);
});

test("a ZKas seed cannot be imported again under another wallet ID", () => {
  const seed = "ab".repeat(32);
  expect(() => assertUniqueZKasSeed([
    { id: "standalone", type: "zkasSeed", value: seed },
  ], seed.toUpperCase())).toThrow(/already imported/i);
  expect(() => assertUniqueZKasSeed([
    { id: "legacy", type: "privateKey", value: "01".repeat(32), zkasSeedHex: seed },
  ], `0x${seed}`)).toThrow(/already imported/i);
  expect(assertUniqueZKasSeed([], seed.toUpperCase())).toBe(seed);
});

test("an interrupted import recovers its encrypted seed without making a second wallet ID", () => {
  const seed = "cd".repeat(32);
  const orphan = { id: "first-attempt", type: "zkasSeed" as const, value: seed };
  const recovered = addOrRecoverZKasSeed([orphan], walletSettings, seed, "retry-id");
  expect(recovered).toEqual({ id: orphan.id, secrets: [orphan] });
  expect(addOrRecoverZKasSeed([], walletSettings, seed, "new-id")).toEqual({
    id: "new-id", secrets: [{ id: "new-id", type: "zkasSeed", value: seed }],
  });
  const persistedWallet = { ...walletSettings, wallets: [...walletSettings.wallets, {
    id: orphan.id, type: "zkasSeed" as const, name: "ZKas", backed: true,
    accounts: [{ index: 0, name: "Account 0", address: "zkas:seed" }],
  }] };
  expect(() => addOrRecoverZKasSeed([orphan], persistedWallet, seed, "retry-id"))
    .toThrow(/already imported/i);
});

test("address selector derives only the selected recovery-phrase account", async () => {
  const wallets = {
    ...walletSettings,
    selectedAccountIndex: 2,
    wallets: [{ ...walletSettings.wallets[0], accounts: [
      { index: 0, name: "First", address: "kaspa:first" },
      { index: 2, name: "Third", address: "kaspa:third" },
    ] }],
  } satisfies WalletSettings;
  const requested: number[] = [];
  const result = await getSelectedAvailableZKasAddress(wallets, [
    { id: "wallet-1", type: "mnemonic", value: "phrase" },
  ], async (_source, index) => {
    requested.push(index);
    return `zkas:account-${index}`;
  });

  expect(result).toEqual({ walletId: "wallet-1", accountIndex: 2, network: "mainnet", address: "zkas:account-2" });
  expect(requested).toEqual([2]);
});

test("address selector shows an attached ZKas seed only for its selected wallet", async () => {
  const seed = "01".repeat(32);
  const wallets = {
    ...walletSettings,
    wallets: [
      { ...walletSettings.wallets[0], accounts: [
        { index: 0, name: "First", address: "kaspa:first" },
        { index: 2, name: "Third", address: "kaspa:third" },
      ] },
      { id: "seed-wallet", name: "Seed wallet", type: "privateKey" as const, backed: true,
        accounts: [{ index: 0, name: "Imported", address: "kaspa:imported" }] },
      { id: "kaspa-only", name: "Kaspa only", type: "privateKey" as const, backed: true,
        accounts: [{ index: 0, name: "Kaspa", address: "kaspa:only" }] },
      { id: "passphrase", name: "Passphrase", type: "mnemonic" as const, backed: true,
        accounts: [{ index: 0, name: "Passphrase", address: "kaspa:passphrase" }] },
      { id: "ledger", name: "Ledger", type: "ledger" as const, backed: true,
        accounts: [{ index: 0, name: "Ledger", address: "kaspa:ledger" }] },
    ],
  } satisfies WalletSettings;
  const secrets = [
    { id: "wallet-1", type: "mnemonic" as const, value: "phrase" },
    { id: "seed-wallet", type: "privateKey" as const, value: "02".repeat(32), zkasSeedHex: seed },
    { id: "kaspa-only", type: "privateKey" as const, value: "03".repeat(32) },
    { id: "passphrase", type: "mnemonic" as const, value: "other phrase", passphrase: "secret" },
    { id: "ledger", type: "ledger" as const, value: "ledger-secret" },
  ];
  const derivations: string[] = [];
  const derive = async (source: { type: "mnemonic" | "seed"; value: string }, index: number) => {
    derivations.push(`${source.type}:${index}`);
    return `zkas:${source.type}-${index}`;
  };

  const selected = await getSelectedAvailableZKasAddress(
    { ...wallets, selectedWalletId: "seed-wallet", selectedAccountIndex: 0 },
    secrets,
    derive,
  );
  expect(selected).toEqual({ walletId: "seed-wallet", accountIndex: 0, network: "mainnet", address: "zkas:seed-0" });
  expect(derivations).toEqual(["seed:0"]);
  expect(JSON.stringify(selected)).not.toContain(seed);

  for (const selectedWalletId of ["kaspa-only", "passphrase", "ledger"]) {
    expect(await getSelectedAvailableZKasAddress(
      { ...wallets, selectedWalletId, selectedAccountIndex: 0 },
      secrets,
      derive,
    )).toBeNull();
  }
  expect(derivations).toEqual(["seed:0"]);
});

test("a standalone ZKas seed is an independent wallet and leaves the selected phrase unchanged", async () => {
  const seed = "05".repeat(32);
  const wallets = {
    ...walletSettings,
    wallets: [
      walletSettings.wallets[0],
      { id: "shielded-wallet", name: "ZKas seed 1", type: "zkasSeed" as const, backed: true,
        accounts: [{ index: 0, name: "Account 0", address: "zkas:shielded" }] },
    ],
  } satisfies WalletSettings;
  const secrets = [
    { id: "wallet-1", type: "mnemonic" as const, value: "phrase" },
    { id: "shielded-wallet", type: "zkasSeed" as const, value: seed },
  ];
  const derive = async (source: { type: "mnemonic" | "seed"; value: string }) =>
    source.type === "seed" ? "zkas:shielded" : "zkas:phrase";

  expect((await getSelectedAvailableZKasAddress(wallets, secrets, derive))?.address)
    .toBe("zkas:phrase");
  const shieldedSelection = { walletId: "shielded-wallet", accountIndex: 0, network: "mainnet" as const };
  expect(getZKasSecretSource(secrets, shieldedSelection)).toEqual({ type: "seed", value: seed });
  expect(await getSelectedAvailableZKasAddress(
    { ...wallets, selectedWalletId: "shielded-wallet", selectedAccountIndex: 0 }, secrets, derive,
  )).toEqual({ ...shieldedSelection, address: "zkas:shielded" });
});

test("ZKas wallet switcher lists phrase, standalone seed, and legacy attached seed addresses", async () => {
  const wallets = {
    ...walletSettings,
    wallets: [
      walletSettings.wallets[0],
      { id: "standalone", type: "zkasSeed" as const, name: "ZKas seed", backed: true,
        accounts: [{ index: 0, name: "Account 0", address: "zkas:stored" }] },
      { id: "legacy-attached", type: "privateKey" as const, name: "Kaspa with seed", backed: true,
        accounts: [{ index: 0, name: "Account 0", address: "kaspa:legacy" }] },
      { id: "kaspa-only", type: "privateKey" as const, name: "Kaspa only", backed: true,
        accounts: [{ index: 0, name: "Account 0", address: "kaspa:only" }] },
      { id: "ledger", type: "ledger" as const, name: "Ledger", backed: true,
        accounts: [{ index: 0, name: "Account 0", address: "kaspa:ledger" }] },
    ],
  } satisfies WalletSettings;
  const secrets = [
    { id: "wallet-1", type: "mnemonic" as const, value: "phrase" },
    { id: "standalone", type: "zkasSeed" as const, value: "01".repeat(32) },
    { id: "legacy-attached", type: "privateKey" as const, value: "02".repeat(32), zkasSeedHex: "03".repeat(32) },
    { id: "kaspa-only", type: "privateKey" as const, value: "04".repeat(32) },
    { id: "ledger", type: "ledger" as const, value: "device" },
  ];
  const derived: string[] = [];
  const entries = await listZKasSwitchAccounts(wallets, secrets, async (source, index) => {
    derived.push(`${source.type}:${index}`);
    return `zkas:${source.type}-${index}`;
  });

  expect(entries).toEqual([
    { walletId: "wallet-1", accountIndex: 1, network: "mainnet", address: "zkas:mnemonic-1", source: "recoveryPhrase" },
    { walletId: "standalone", accountIndex: 0, network: "mainnet", address: "zkas:seed-0", source: "importedSeed" },
    { walletId: "legacy-attached", accountIndex: 0, network: "mainnet", address: "zkas:seed-0", source: "importedSeed" },
  ]);
  expect(derived).toEqual(["mnemonic:1", "seed:0", "seed:0"]);
});

test("a delayed address response cannot show another wallet or account", async () => {
  const expected = { walletId: "wallet-1", accountIndex: 1, network: "mainnet" as const };
  let finishRequest!: (account: typeof expected & { address: string }) => void;
  const pending = new Promise<typeof expected & { address: string }>((resolve) => { finishRequest = resolve; });
  const display = pending.then((account) => requireSelectedZKasAddress(account, expected));
  finishRequest({ ...expected, walletId: "wallet-2", address: "zkas:other-wallet" });
  await expect(display).rejects.toThrow(/selected ZKas account changed/i);

  expect(() => requireSelectedZKasAddress({ ...expected, accountIndex: 2, address: "zkas:other-account" }, expected))
    .toThrow(/selected ZKas account changed/i);
  expect(() => requireSelectedZKasAddress({ ...expected, network: "testnet", address: "zkas:other-network" }, expected))
    .toThrow(/selected ZKas account changed/i);
  expect(requireSelectedZKasAddress({ ...expected, address: "zkas:selected" }, expected)?.address)
    .toBe("zkas:selected");
  expect(requireSelectedZKasAddress(null, expected)).toBeNull();
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
