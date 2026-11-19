import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import type { IUtxoEntry, Transaction } from "@/wasm/core/kaspa";
import {
  assertSignerOwnsAddress,
  planConsolidationRound,
  runConsolidation,
  SignerMismatchError,
  SignerUnavailableError,
} from "@/lib/consolidate";
import {
  AccountFactory,
  LegacyAccountFactory,
} from "@/lib/wallet/account-factory";
import type { IWallet } from "@/lib/wallet/wallet-interface";
import {
  resolveAccountIsLegacy,
  resolveIsLegacy,
} from "@/lib/wallet/resolve-derivation";

// The signer hooks pick the derivation whose key 0 locks to the account's
// address, not the one the wallet flag names. Real WASM keys from the
// background's own factories (legacy: m/44'/111111'/i'/0/0, standard:
// m/44'/111111'/0'/0/i).

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// Not derivable from MNEMONIC: a foreign key.
const KEY_B =
  "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

// The account the background signs with, as lib/service/handlers/kaspa/utils.ts
// builds it from (secret, index, isLegacy).
const accountFor = (isLegacy: boolean, index: number): IWallet =>
  (isLegacy
    ? new LegacyAccountFactory()
    : new AccountFactory()
  ).createFromMnemonic(MNEMONIC, index);

const addressOf = async (account: IWallet) =>
  (await account.getPublicKey()).toAddress("mainnet").toString();

// firstPublicKey for a recovery-phrase wallet at `index`, counted.
const keysAt = (index: number) => {
  const derivations: boolean[] = [];
  const firstPublicKey = async (isLegacy: boolean) => {
    derivations.push(isLegacy);
    return (await accountFor(isLegacy, index).getPublicKeys())[0];
  };
  return { derivations, firstPublicKey };
};

// 81 × 2.0604 KAS on `address`: one sweep of 80 inputs at the default size.
const entriesOn = (address: string) =>
  Array.from({ length: 81 }, (_, i) => ({
    address,
    outpoint: {
      transactionId: (i + 1).toString(16).padStart(64, "0"),
      index: 0,
    },
    amount: 206_040_000n,
    scriptPublicKey: payToAddressScript(address),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];

// The account as the popup's signer hook exposes it, counted; keeps every
// transaction it signed.
const counted = (account: IWallet) => {
  const calls = { getAddress: 0, signTx: 0, submit: 0 };
  const signed: Transaction[] = [];
  const signer = {
    getAddress: async () => (calls.getAddress++, addressOf(account)),
    signTx: async (tx: Transaction) => {
      calls.signTx++;
      const out = await account.signTx(tx);
      signed.push(out);
      return out;
    },
  };
  const rpc = {
    submitTransaction: async () => (
      calls.submit++, { transactionId: "00".repeat(32) } as never
    ),
  };
  return { calls, signed, signer, rpc };
};

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

test.describe("resolveIsLegacy", () => {
  test("legacy record at index 1, flag unset: selects legacy, and the round signs and submits", async () => {
    const recordAddress = await addressOf(accountFor(true, 1));
    expect(await addressOf(accountFor(false, 1))).not.toBe(recordAddress);
    const { firstPublicKey } = keysAt(1);

    const isLegacy = await resolveIsLegacy(
      recordAddress,
      false,
      "mainnet",
      firstPublicKey,
    );
    expect(isLegacy).toBe(true);

    const { plan } = await planConsolidationRound({
      entries: entriesOn(recordAddress),
      changeAddress: recordAddress,
      networkId: "mainnet",
    });
    expect(plan?.transactions).toHaveLength(1);
    const { calls, signed, signer, rpc } = counted(accountFor(isLegacy, 1));
    const result = await runConsolidation(plan!.transactions, signer, rpc, {
      ownerAddress: plan!.ownerAddress,
    });
    expect(result.submitted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(calls.signTx).toBe(1);
    expect(calls.submit).toBe(1);
    expect(signed[0].inputs).toHaveLength(80);
    for (const input of signed[0].inputs) {
      expect(input.signatureScript).toBeTruthy();
    }
  });

  for (const flag of [false, true]) {
    test(`foreign record address, flag ${flag}: keeps the flag after both derivations, and the guard refuses`, async () => {
      const recordAddress = new PrivateKey(KEY_B)
        .toPublicKey()
        .toAddress("mainnet")
        .toString();
      const { derivations, firstPublicKey } = keysAt(1);

      const isLegacy = await resolveIsLegacy(
        recordAddress,
        flag,
        "mainnet",
        firstPublicKey,
      );
      expect(isLegacy).toBe(flag);
      expect(derivations).toEqual([flag, !flag]);

      const { plan } = await planConsolidationRound({
        entries: entriesOn(recordAddress),
        changeAddress: recordAddress,
        networkId: "mainnet",
      });
      const { calls, signer, rpc } = counted(accountFor(isLegacy, 1));
      await expect(
        runConsolidation(plan!.transactions, signer, rpc, {
          ownerAddress: plan!.ownerAddress,
        }),
      ).rejects.toBeInstanceOf(SignerMismatchError);
      expect(calls.getAddress).toBe(1);
      expect(calls.signTx).toBe(0);
      expect(calls.submit).toBe(0);
    });
  }

  for (const flag of [false, true]) {
    test(`index 0, flag ${flag}: returns the flag after one derivation`, async () => {
      const recordAddress = await addressOf(accountFor(flag, 0));
      const { derivations, firstPublicKey } = keysAt(0);
      expect(
        await resolveIsLegacy(recordAddress, flag, "mainnet", firstPublicKey),
      ).toBe(flag);
      expect(derivations).toEqual([flag]);
    });
  }

  test("standard record at index 2, flag unset (account added since v2.44): standard after one derivation", async () => {
    const recordAddress = await addressOf(accountFor(false, 2));
    const { derivations, firstPublicKey } = keysAt(2);
    expect(
      await resolveIsLegacy(recordAddress, false, "mainnet", firstPublicKey),
    ).toBe(false);
    expect(derivations).toEqual([false]);
  });

  test("a locked keyring rejects through the resolver, and the guard reports SignerUnavailableError", async () => {
    const recordAddress = await addressOf(accountFor(true, 1));
    const locked = async () => Promise.reject(new Error("Keyring is locked"));
    const signer = {
      getAddress: async () =>
        addressOf(
          accountFor(
            await resolveIsLegacy(recordAddress, false, "mainnet", locked),
            1,
          ),
        ),
    };
    await expect(
      assertSignerOwnsAddress(signer, recordAddress),
    ).rejects.toBeInstanceOf(SignerUnavailableError);
  });
});

test.describe("resolveAccountIsLegacy", () => {
  test("Ledger: 144 signatures need one key exchange for the resolution, none between signatures", async () => {
    const recordAddress = await addressOf(accountFor(true, 1));
    const exchanges: string[] = [];
    const device = async (isLegacy: boolean) => {
      exchanges.push("getPublicKey");
      return (await accountFor(isLegacy, 1).getPublicKeys())[0];
    };
    for (let i = 0; i < 144; i++) {
      // what each signTx of the Ledger hook does before it signs
      expect(
        await resolveAccountIsLegacy(
          "ledger-144",
          1,
          recordAddress,
          true,
          "mainnet",
          device,
        ),
      ).toBe(true);
      exchanges.push("sign");
    }
    expect(exchanges[0]).toBe("getPublicKey");
    expect(exchanges.filter((e) => e === "getPublicKey")).toHaveLength(1);
    expect(exchanges.slice(1)).toEqual(Array(144).fill("sign"));
  });

  test("a rejection is not cached: the next call derives again", async () => {
    const recordAddress = await addressOf(accountFor(true, 1));
    let attempts = 0;
    const firstPublicKey = async (isLegacy: boolean) => {
      attempts++;
      if (attempts === 1) throw new Error("Keyring is locked");
      return (await accountFor(isLegacy, 1).getPublicKeys())[0];
    };
    const resolve = () =>
      resolveAccountIsLegacy(
        "locked-then-unlocked",
        1,
        recordAddress,
        false,
        "mainnet",
        firstPublicKey,
      );
    await expect(resolve()).rejects.toThrow("Keyring is locked");
    expect(await resolve()).toBe(true);
    expect(await resolve()).toBe(true);
    // one failed call, then the flag's key and the legacy key, then cached
    expect(attempts).toBe(3);
  });
});
