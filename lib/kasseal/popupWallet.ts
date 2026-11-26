import type useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";
import type { KassealWallet } from "./sign";

type HotSigner = NonNullable<ReturnType<typeof useKaspaHotWalletSigner>>;

/**
 * The wallet signKassealTx signs with, in the popup. The popup holds no keys:
 * both methods are the hot signer's background calls, passed through as they
 * are. The argument's type is the proof that they fit IWallet's.
 */
export const kassealPopupWallet = ({
  signInputDigest,
  signTx,
}: Pick<HotSigner, "signInputDigest" | "signTx">): KassealWallet => ({
  signInputDigest,
  signTx,
});
