import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { schnorrSighash } from "@dotk/sdk-tx";
import { schnorr } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils";
import init, { PrivateKey } from "@/wasm/core/kaspa";
import { braidWalletJsonToTx } from "@/lib/braid/adapter";
import { braidErrorCopy } from "@/lib/braid/client";
import {
  BraidSignRefusal,
  braidSignerFor,
  kastleBraidSigner,
  type BraidDeposit,
} from "@/lib/braid/signer";
import { signV1Input } from "@/lib/kcc20/sign-v1";
import { HotWalletPrivateKey } from "@/lib/wallet/account/hot-wallet-private-key";
import { LedgerAccount } from "@/lib/wallet/account/ledger-account";
import { KCC20_LEDGER_UNSUPPORTED_MESSAGE } from "@/lib/wallet/sign-script";
import {
  type IWallet,
  LedgerUnsupportedError,
} from "@/lib/wallet/wallet-interface";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
// SYNTHETIC: serialized by the SDK's own l1.walletJson, not a server build.
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(TESTS_DIR, "fixtures/braid/deposit.synthetic.json"),
    "utf8",
  ),
) as {
  privateKeyHex: string;
  xOnlyPk: string;
  signInputs: number[];
  walletJson: string;
  braidSighashes: Record<number, string>;
};

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const keyOf = () => hexToBytes(fixture.privateKeyHex);

const deposit = (over: Partial<BraidDeposit> = {}): BraidDeposit => ({
  ref: "ref-1",
  network: "tn10",
  userPublicKey: fixture.xOnlyPk,
  signInputs: fixture.signInputs,
  sighashes: { ...fixture.braidSighashes },
  walletJson: fixture.walletJson,
  ...over,
});

const withTx = (edit: (t: any) => void) => {
  const t = JSON.parse(fixture.walletJson);
  edit(t);
  return JSON.stringify(t);
};

const refusal = (message: string) => new BraidSignRefusal(message).message;

test.describe("signV1Input", () => {
  test("is 41 ‖ sig64 ‖ 01 over the input's SIGHASH_ALL digest", () => {
    const tx = braidWalletJsonToTx(fixture.walletJson);
    const script = signV1Input(tx, 0, keyOf());
    expect(script).toMatch(/^41[0-9a-f]{128}01$/);
    expect(
      schnorr.verify(
        script.slice(2, 130),
        schnorrSighash(tx, 0),
        fixture.xOnlyPk,
      ),
    ).toBe(true);
  });
});

test.describe("kastleBraidSigner", () => {
  test("reports the x-only key", async () => {
    const signer = kastleBraidSigner(
      async () => keyOf(),
      fixture.xOnlyPk.toUpperCase(),
    );
    await expect(signer.getPublicKey()).resolves.toBe(fixture.xOnlyPk);
  });

  test("signs exactly the listed inputs with 64-byte signatures that verify", async () => {
    const signer = kastleBraidSigner(async () => keyOf(), fixture.xOnlyPk);
    const sigs = await signer.signDeposit(deposit());

    expect(Object.keys(sigs).map(Number)).toEqual([0, 1]);
    const tx = braidWalletJsonToTx(fixture.walletJson);
    for (const [i, sig] of Object.entries(sigs)) {
      expect(sig).toMatch(/^[0-9a-f]{128}$/);
      expect(
        schnorr.verify(sig, schnorrSighash(tx, Number(i)), fixture.xOnlyPk),
      ).toBe(true);
    }
  });

  test("signs a single listed input and nothing else", async () => {
    const signer = kastleBraidSigner(async () => keyOf(), fixture.xOnlyPk);
    const sigs = await signer.signDeposit(deposit({ signInputs: [1] }));
    expect(Object.keys(sigs)).toEqual(["1"]);
  });

  test("zeroes the key buffer after signing", async () => {
    const key = keyOf();
    await kastleBraidSigner(async () => key, fixture.xOnlyPk).signDeposit(
      deposit(),
    );
    expect(key.every((b) => b === 0)).toBe(true);
  });

  test("zeroes the key buffer when a signature fails to verify", async () => {
    const key = new Uint8Array(32).fill(7); // not the key behind xOnlyPk
    await expect(
      kastleBraidSigner(async () => key, fixture.xOnlyPk).signDeposit(
        deposit(),
      ),
    ).rejects.toThrow(
      refusal("input 0 signature does not verify under the wallet key"),
    );
    expect(key.every((b) => b === 0)).toBe(true);
  });

  test.describe("refuses, without asking for the key,", () => {
    const refuses = async (p: BraidDeposit, message: string) => {
      let keyReads = 0;
      const getKey = async () => {
        keyReads++;
        return keyOf();
      };
      const run = kastleBraidSigner(getKey, fixture.xOnlyPk).signDeposit(p);
      const err = await run.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BraidSignRefusal);
      expect((err as Error).message).toBe(refusal(message));
      // The user sees the shared Braid copy, never the check's detail.
      expect(braidErrorCopy(err, "fallback")).toBe(
        "This swap failed a safety check and was not signed.",
      );
      expect(keyReads).toBe(0);
    };

    test("when the prepared sighash differs from the local one", async () => {
      const sighashes = { ...fixture.braidSighashes, 1: "00".repeat(32) };
      await refuses(
        deposit({ sighashes }),
        "input 1 sighash does not match the prepared one",
      );
    });

    test("when the transaction changed under the prepared sighashes", async () => {
      const walletJson = withTx((t) => (t.outputs[1].value = "1449000001"));
      await refuses(
        deposit({ walletJson }),
        "input 0 sighash does not match the prepared one",
      );
    });

    test("when a listed input has no prepared sighash", async () => {
      const sighashes = { 0: fixture.braidSighashes[0] };
      await refuses(
        deposit({ sighashes }),
        "input 1 sighash does not match the prepared one",
      );
    });

    test("a version-0 transaction", async () => {
      const walletJson = withTx((t) => (t.version = 0));
      await refuses(deposit({ walletJson }), "transaction version 0, not 1");
    });

    test("a deposit prepared for another key", async () => {
      await refuses(
        deposit({ userPublicKey: "ab".repeat(32) }),
        "the deposit was prepared for another key",
      );
    });

    test("an input outside the transaction", async () => {
      await refuses(
        deposit({ signInputs: [0, 3] }),
        "input 3 is not in the transaction",
      );
    });

    test("an input listed twice", async () => {
      await refuses(
        deposit({ signInputs: [0, 0] }),
        "an input is listed twice",
      );
    });

    test("an input that already carries a signature script", async () => {
      await refuses(
        deposit({ signInputs: [2], sighashes: { ...fixture.braidSighashes } }),
        "input 2 is not blank",
      );
    });

    test("an empty input list", async () => {
      await refuses(deposit({ signInputs: [] }), "no inputs to sign");
    });
  });
});

test.describe("braidSignerFor", () => {
  test("signs with a hot key read only after the checks pass", async () => {
    const account = new HotWalletPrivateKey(
      new PrivateKey(fixture.privateKeyHex),
    );
    let keyReads = 0;
    const read = account.getPrivateKeyString.bind(account);
    account.getPrivateKeyString = () => {
      keyReads++;
      return read();
    };
    const signer = braidSignerFor(account, fixture.xOnlyPk);

    await expect(
      signer.signDeposit(deposit({ userPublicKey: "ab".repeat(32) })),
    ).rejects.toThrow(refusal("the deposit was prepared for another key"));
    expect(keyReads).toBe(0);

    const sigs = await signer.signDeposit(deposit());
    expect(keyReads).toBe(1);
    const tx = braidWalletJsonToTx(fixture.walletJson);
    for (const [i, sig] of Object.entries(sigs)) {
      expect(
        schnorr.verify(sig, schnorrSighash(tx, Number(i)), fixture.xOnlyPk),
      ).toBe(true);
    }
  });

  test("refuses a Ledger account with the KCC-20 Ledger message", () => {
    // No device: the guard must fire before anything reaches the transport.
    const ledger = Object.create(LedgerAccount.prototype) as LedgerAccount;
    let reached = false;
    ledger.getPrivateKeyString = () => {
      reached = true;
      return "";
    };
    ledger.signInputDigest = async () => {
      reached = true;
      return new Uint8Array(65);
    };

    let err: unknown;
    try {
      braidSignerFor(ledger, fixture.xOnlyPk);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LedgerUnsupportedError);
    expect((err as Error).message).toBe(KCC20_LEDGER_UNSUPPORTED_MESSAGE);
    expect(reached).toBe(false);
  });

  test("refuses any account that is not a hot wallet", () => {
    const other = {
      getPrivateKeyString: () => fixture.privateKeyHex,
    } as unknown as IWallet;
    expect(() => braidSignerFor(other, fixture.xOnlyPk)).toThrow(
      new LedgerUnsupportedError(KCC20_LEDGER_UNSUPPORTED_MESSAGE),
    );
  });
});
