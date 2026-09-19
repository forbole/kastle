export type WalletSecretType = "privateKey" | "mnemonic" | "ledger";

export interface WalletSecret {
  id: string;
  type: WalletSecretType;
  value: string;
  passphrase?: string;
  /** Explicitly imported ZKas spending seed for an imported-key wallet. */
  zkasSeedHex?: string;
}
