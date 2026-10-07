import { OwnerType } from "@dotk/sdk";
import type { Signer } from "@dotk/sdk-tx";
import { Transaction } from "@/wasm/core/kaspa";
import type { IWallet } from "@/lib/wallet/wallet-interface";

// Adapts a Kastle hot-wallet signer to the sdk-tx Signer port. Owner seats are
// P2SH covenant inputs: sdk-tx seeds each with an entry script (65-byte sig
// placeholder), the wallet signs under SIGHASH_ALL and appends the redeem
// script, and sdk-tx then reads only the first push of the answer and patches
// the placeholder itself, verifying it against the expected digest.
export const makeDotkSigner = (
  walletSigner: Pick<IWallet, "signTx">,
): Signer => ({
  async sign(req) {
    const tx = Transaction.deserializeFromSafeJSON(req.txJson);
    const inputs = tx.inputs;
    // signTx refuses an input that already carries a signatureScript, so lift
    // each seat's entry script out and pass it as the redeem script.
    const scripts = req.ownerSigInputs.map((inputIndex) => {
      const scriptHex = inputs[inputIndex].signatureScript;
      if (!scriptHex)
        throw new Error(`dotk: input ${inputIndex} has no script`);
      inputs[inputIndex].signatureScript = "";
      return { inputIndex, scriptHex };
    });
    tx.inputs = inputs;
    const signed = await walletSigner.signTx(tx, scripts);
    return signed.serializeToSafeJSON();
  },
  // Kastle signs Schnorr only.
  supportsOwnerScheme: (t) => t === OwnerType.Pubkey,
});
