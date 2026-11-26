import { RPC_ERRORS, type RpcError } from "@/api/message";
import { z } from "zod";
import { ScriptOption } from "@/lib/wallet/wallet-interface.ts";

export const SignTxPayloadSchema = z.object({
  networkId: z.string().optional(),
  txJson: z.string(),
  scripts: z.array(z.custom<ScriptOption>()).default([]),
  // Set by the covenant guard only (the handler overwrites any dApp value):
  // the account the request was checked for.
  admittedFor: z.string().optional(),
});

export type SignTxPayload = z.infer<typeof SignTxPayloadSchema>;

const isJson = (s: string) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

/**
 * Kasware's signPskt payload. Kasware's "PSKT" is the Safe JSON signTx already
 * takes, so txJsonString is a txJson. sighashType stays unknown here:
 * toPsktSignType refuses a bad one by name, which a schema failure cannot.
 * Null / hole entries are skipped, as signTx skips them in `scripts`.
 * Unknown fields are stripped, never forwarded.
 */
export const SignPsktPayloadSchema = z.object({
  txJsonString: z.string().refine(isJson),
  options: z
    .object({
      signInputs: z
        .array(
          z
            .object({
              index: z.number().int().nonnegative(),
              sighashType: z.unknown(),
            })
            .nullish(),
        )
        .optional(),
    })
    .optional(),
});

export type SignPsktPayload = z.infer<typeof SignPsktPayloadSchema>;

/** The `/sign-tx` popup's `method` URL param for a signPskt request; set by the background only. */
export const SIGN_PSKT_METHOD = "signPskt";

/** The account a request's checks ran for: wallet id plus account index. */
export const accountFingerprint = (walletId: string, accountIndex: number) =>
  `${walletId}:${accountIndex}`;

/**
 * Checked at confirm, before signing: a request admitted for one account
 * refuses if another is selected now. Covenant requests and every signPskt
 * request carry an admission; a version-0 signTx or signAndBroadcastTx does
 * not and is never refused here.
 */
export function admissionRefusal(
  payload: Pick<SignTxPayload, "admittedFor">,
  walletId: string | undefined,
  accountIndex: number | undefined,
): RpcError | undefined {
  if (payload.admittedFor === undefined) return undefined;
  return walletId !== undefined &&
    accountIndex !== undefined &&
    accountFingerprint(walletId, accountIndex) === payload.admittedFor
    ? undefined
    : RPC_ERRORS.COVENANT_ACCOUNT_CHANGED;
}

/**
 * M2: a covenant (version >= 1) tx can spend the user's KCC-20 pieces — the
 * covenant only checks that a co-present input is the owner's P2PK — so dApp
 * sign requests for one are opened only when canDecodeCovenantRequest can
 * show which pieces leave the wallet. The wallet's own KCC-20 send/swap signs
 * via wallet.signTx directly and never passes through here.
 * Fail closed: anything that isn't a parseable version-0 tx counts as covenant.
 */
export function isCovenantTxJson(txJson: string): boolean {
  try {
    return JSON.parse(txJson).version !== 0;
  } catch {
    return true;
  }
}
