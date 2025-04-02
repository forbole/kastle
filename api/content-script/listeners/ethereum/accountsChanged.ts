import { storage } from "wxt/storage";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import { ApiResponse } from "@/api/message";
import { publicKeyToAddress } from "viem/accounts";

export class EthereumAccountsChangedListener {
  constructor(private currentAddress?: string) {
    // Initialize from storage
    storage
      .getItem<WalletSettings>(WALLET_SETTINGS)
      .then((walletSettings: WalletSettings | null) => {
        if (walletSettings) {
          const selectedWalletId = walletSettings.selectedWalletId;
          const selectedAccountIndex = walletSettings.selectedAccountIndex;

          const publicKey = walletSettings.wallets
            .find((w) => w.id === selectedWalletId)
            ?.accounts.find((a) => a.index === selectedAccountIndex)
            ?.publicKeys?.[0];

          if (publicKey) {
            this.currentAddress = publicKeyToAddress(
              `0x${publicKey}` as `0x${string}`,
            );
          }
        }
      });
  }

  start() {
    storage.watch(WALLET_SETTINGS, (walletSettings: WalletSettings | null) => {
      if (walletSettings) {
        const selectedWalletId = walletSettings.selectedWalletId;
        const selectedAccountIndex = walletSettings.selectedAccountIndex;

        const selectedPublicKey = walletSettings.wallets
          .find((w) => w.id === selectedWalletId)
          ?.accounts.find((a) => a.index === selectedAccountIndex)
          ?.publicKeys?.[0];

        if (!selectedPublicKey) {
          return;
        }

        const selectedAddress = publicKeyToAddress(
          `0x${selectedPublicKey}` as `0x${string}`,
        );

        if (this.currentAddress !== selectedAddress) {
          this.currentAddress = selectedAddress;
          window.postMessage(
            new ApiResponse("accountsChanged", [selectedAddress]),
            window.location.origin,
          );
        }
      }
    });
  }
}
