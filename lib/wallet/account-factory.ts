import { Mnemonic, PrivateKey } from "@/wasm/core/kaspa";
import {
  Mnemonic as MnemonicLegacy,
  PrivateKey as PrivateKeyLegacy,
} from "@/wasm/legacy/kaspa";
import {
  LegacyHotWalletAccount,
  HotWalletAccount,
} from "@/lib/wallet/account/hot-wallet-account.ts";
import { IWallet } from "./wallet-interface.ts";
import { HotWalletPrivateKey } from "@/lib/wallet/account/hot-wallet-private-key.ts";
import {
  LegacyLedgerAccount,
  LedgerAccount,
} from "@/lib/wallet/account/ledger-account.ts";
import {
  LegacyWasmLegacyHotWalletAccount,
  LegacyWasmHotWalletAccount,
} from "@/lib/wallet/account/legacy/hot-wallet-account.ts";
import { LegacyWasmHotWalletPrivateKey } from "@/lib/wallet/account/legacy/hot-wallet-private-key.ts";
import {
  LegacyWasmLegacyLedgerAccount,
  LegacyWasmLedgerAccount,
} from "@/lib/wallet/account/legacy/ledger-account.ts";
import Transport from "@ledgerhq/hw-transport";

export class LegacyAccountFactory {
  static generateMnemonic(): string {
    return Mnemonic.random(12).phrase;
  }

  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LegacyLedgerAccount(transport, accountIndex);
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    const seed = new Mnemonic(mnemonic).toSeed();

    return new LegacyHotWalletAccount(seed, accountIndex);
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new HotWalletPrivateKey(new PrivateKey(privateKey));
  }
}

export class AccountFactory {
  constructor() {}

  static generateMnemonic(): string {
    return Mnemonic.random(12).phrase;
  }

  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LedgerAccount(transport, accountIndex);
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    const seed = new Mnemonic(mnemonic).toSeed();

    return new HotWalletAccount(seed, accountIndex);
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new HotWalletPrivateKey(new PrivateKey(privateKey));
  }
}

/**
 * Mainnet account factories — use legacy WASM for signing so that produced
 * transactions are compatible with Kaspa node 1.2.0.
 */
export class LegacyWasmLegacyAccountFactory {
  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LegacyWasmLegacyLedgerAccount(transport, accountIndex);
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    // MnemonicLegacy.toSeed() produces the same BIP39 seed as the new WASM
    const seed = new MnemonicLegacy(mnemonic).toSeed();
    return new LegacyWasmLegacyHotWalletAccount(seed, accountIndex);
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new LegacyWasmHotWalletPrivateKey(new PrivateKeyLegacy(privateKey));
  }
}

export class LegacyWasmAccountFactory {
  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LegacyWasmLedgerAccount(transport, accountIndex);
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    const seed = new MnemonicLegacy(mnemonic).toSeed();
    return new LegacyWasmHotWalletAccount(seed, accountIndex);
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new LegacyWasmHotWalletPrivateKey(new PrivateKeyLegacy(privateKey));
  }
}
