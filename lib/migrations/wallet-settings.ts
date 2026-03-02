import { PublicKey } from "@/wasm/core/kaspa";
import { WalletSettings } from "@/contexts/WalletManagerContext";
import { NetworkType } from "@/contexts/SettingsContext";

export const WALLET_SETTINGS_VERSION = 1;

export interface MigrationContext {
  kaspaSigner: {
    getPublicKeys: (params: {
      walletId: string;
      accountIndex: number;
      isLegacy: boolean;
    }) => Promise<{ publicKeys: string[] }>;
  };
  evmSigner: {
    getPublicKey: (params: {
      walletId: string;
      accountIndex: number;
      isLegacy: boolean;
      isKastleLegacy: boolean;
    }) => Promise<{ publicKey: `0x${string}` }>;
  };
  settings?: {
    isLegacyFeaturesEnabled?: boolean;
    isLegacyEvmAddressEnabled?: boolean;
  };
  networkId: NetworkType;
}

/**
 * Migration: Generate missing keys (first time or old version upgrade)
 * This migration runs only once when version is not set or less than current version
 */
export async function migrateWalletSettings(
  prev: WalletSettings,
  context: MigrationContext,
): Promise<WalletSettings> {
  const { kaspaSigner, evmSigner, settings, networkId } = context;
  const wallets = prev.wallets;

  // Validate required context
  if (!networkId) {
    throw new Error("Migration failed: networkId is required");
  }
  if (!kaspaSigner || !evmSigner) {
    throw new Error("Migration failed: signers are required");
  }

  if (!wallets) {
    return { ...prev, version: WALLET_SETTINGS_VERSION };
  }

  let updated = false;
  const newWallets = await Promise.all(
    wallets.map(async (wallet) => {
      if (wallet.type === "ledger") return wallet;

      // Determine legacy mode based on current settings
      const isKastleLegacy = settings?.isLegacyFeaturesEnabled
        ? (wallet.isLegacyWalletEnabled ?? false)
        : false;
      const isEvmLegacy = settings?.isLegacyFeaturesEnabled
        ? (settings?.isLegacyEvmAddressEnabled ?? false)
        : false;

      const newAccounts = await Promise.all(
        wallet.accounts.map(async (account) => {
          // Skip if already has both keys
          if (account.publicKeys?.length && account.evmPublicKey) {
            return account;
          }

          updated = true;

          // Generate EVM public key based on current settings
          const { publicKey: evmPublicKey } = await evmSigner.getPublicKey({
            walletId: wallet.id,
            accountIndex: account.index,
            isLegacy: isEvmLegacy,
            isKastleLegacy,
          });

          // Generate Kaspa public keys based on current settings
          const { publicKeys: kaspaPublicKeys } =
            await kaspaSigner.getPublicKeys({
              walletId: wallet.id,
              accountIndex: account.index,
              isLegacy: isKastleLegacy,
            });

          const kaspaAddress = new PublicKey(kaspaPublicKeys[0])
            .toAddress(networkId)
            .toString();

          return {
            ...account,
            evmPublicKey,
            publicKeys: kaspaPublicKeys,
            address: kaspaAddress,
          };
        }),
      );

      return { ...wallet, accounts: newAccounts };
    }),
  );

  return {
    ...prev,
    wallets: updated ? newWallets : wallets,
    version: WALLET_SETTINGS_VERSION,
  };
}
