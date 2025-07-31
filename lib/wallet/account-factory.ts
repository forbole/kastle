import { Mnemonic, PrivateKey, RpcClient } from "@/wasm/core/kaspa";
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
import { NetworkType } from "@/contexts/SettingsContext.tsx";

export class LegacyAccountFactory {
  constructor(
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {}

  static generateMnemonic(): string {
    return Mnemonic.random(12).phrase;
  }

  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LegacyLedgerAccount(
      transport,
      accountIndex,
      this.rpcClient,
      this.networkId,
    );
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    const seed = new Mnemonic(mnemonic).toSeed();

    return new LegacyHotWalletAccount(
      seed,
      accountIndex,
      this.rpcClient,
      this.networkId,
    );
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new HotWalletPrivateKey(
      new PrivateKey(privateKey),
      this.rpcClient,
      this.networkId,
    );
  }
}

export class AccountFactory {
  constructor(
    private readonly rpcClient: RpcClient,
    private readonly networkId: NetworkType,
  ) {}

  static generateMnemonic(): string {
    return Mnemonic.random(12).phrase;
  }

  createFromLedger(transport: Transport, accountIndex: number = 0): IWallet {
    return new LedgerAccount(
      transport,
      accountIndex,
      this.rpcClient,
      this.networkId,
    );
  }

  createFromMnemonic(mnemonic: string, accountIndex: number = 0): IWallet {
    const seed = new Mnemonic(mnemonic).toSeed();

    return new HotWalletAccount(
      seed,
      accountIndex,
      this.rpcClient,
      this.networkId,
    );
  }

  createFromPrivateKey(privateKey: string): IWallet {
    return new HotWalletPrivateKey(
      new PrivateKey(privateKey),
      this.rpcClient,
      this.networkId,
    );
  }
}
