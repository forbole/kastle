import { payToAddressScript, PublicKey } from "@/wasm/core/kaspa";
import { sameScript } from "@/lib/consolidate";

/**
 * The derivation (legacy or standard) whose key 0 locks to `accountAddress`.
 * The wallet flag alone can disagree with the account record: wallets from
 * before v2.33.0 keep legacy keys with the flag unset, and unset has meant
 * standard since v2.44.0. Returns `flag` when its key matches, `!flag` when
 * the other key matches, and `flag` when neither does (the ownership guard
 * then refuses). A `firstPublicKey` rejection passes through.
 */
export async function resolveIsLegacy(
  accountAddress: string,
  flag: boolean,
  networkId: string,
  firstPublicKey: (isLegacy: boolean) => Promise<string>,
): Promise<boolean> {
  let owner;
  try {
    owner = payToAddressScript(accountAddress);
  } catch {
    return flag;
  }
  const owns = async (isLegacy: boolean) =>
    sameScript(
      payToAddressScript(
        new PublicKey(await firstPublicKey(isLegacy)).toAddress(networkId),
      ),
      owner,
    );
  if (await owns(flag)) return flag;
  if (await owns(!flag)) return !flag;
  return flag;
}

// A Ledger takes one exchange at a time: resolve once per account, not before
// every signature. A rejection is not kept, so a locked keyring retries.
const resolved = new Map<string, Promise<boolean>>();

export function resolveAccountIsLegacy(
  walletId: string,
  accountIndex: number,
  accountAddress: string,
  flag: boolean,
  networkId: string,
  firstPublicKey: (isLegacy: boolean) => Promise<string>,
): Promise<boolean> {
  const key = `${walletId}:${accountIndex}:${accountAddress}:${flag}`;
  let result = resolved.get(key);
  if (!result) {
    result = resolveIsLegacy(accountAddress, flag, networkId, firstPublicKey);
    resolved.set(key, result);
    result.catch(() => resolved.delete(key));
  }
  return result;
}
