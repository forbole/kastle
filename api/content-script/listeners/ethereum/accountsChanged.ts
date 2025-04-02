import { storage } from "wxt/storage";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import { ApiResponse } from "@/api/message";
import { publicKeyToAddress } from "viem/accounts";
import { ApiUtils } from "@/api/background/utils";

export class EthereumAccountsChangedListener {
  constructor(private currentAddress?: string) {
    // Initialize from storage
    storage
      .getItem<WalletSettings>(WALLET_SETTINGS)
      .then(async (walletSettings: WalletSettings | null) => {
        if (walletSettings) {
          const isHostConnected = await ApiUtils.isHostConnected(
            window.location.host,
          );
          if (!isHostConnected) {
            return;
          }

          const account = await ApiUtils.getCurrentAccount();
          if (!account?.publicKeys) {
            return;
          }

          const selectedPublicKey = account.publicKeys[0];
          if (selectedPublicKey) {
            this.currentAddress = publicKeyToAddress(
              `0x${selectedPublicKey}` as `0x${string}`,
            );
          }
        }
      });
  }

  start() {
    storage.watch(
      WALLET_SETTINGS,
      async (walletSettings: WalletSettings | null) => {
        if (walletSettings) {
          // send empty addresses array if host is not connected
          const isHostConnected = await ApiUtils.isHostConnected(
            window.location.host,
          );
          if (!isHostConnected) {
            this.currentAddress = undefined;
            window.postMessage(
              new ApiResponse("accountsChanged", []),
              window.location.origin,
            );
            return;
          }

          const account = await ApiUtils.getCurrentAccount();
          if (!account?.publicKeys) {
            return;
          }

          const selectedPublicKey = account.publicKeys[0];
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
      },
    );
  }
}
