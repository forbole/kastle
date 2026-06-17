import { Mnemonic, PrivateKey } from "@/wasm/core/kaspa";
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
