export interface IWallet {
  signMessage(message: string): Promise<string>;
}
