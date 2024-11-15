export type WalletSecretType = "privateKey" | "mnemonic" | "ledger";

export interface WalletSecret {
  id: string;
  type: WalletSecretType;
  value: string;
}
