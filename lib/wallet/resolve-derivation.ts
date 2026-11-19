import { payToAddressScript, PublicKey } from "@/wasm/core/kaspa";
import { sameScript } from "@/lib/consolidate";

/**
 * The derivation (legacy or standard) whose key 0 locks to `accountAddress`,
 * or undefined when neither does. The wallet flag alone can disagree with the
 * account record: wallets from before v2.33.0 keep legacy keys with the flag
 * unset, and unset has meant standard since v2.44.0. The flag's derivation is
 * tried first. A `firstPublicKey` rejection passes through.
 */
async function matchIsLegacy(
  accountAddress: string,
  flag: boolean,
  networkId: string,
  firstPublicKey: (isLegacy: boolean) => Promise<string>,
): Promise<boolean | undefined> {
  let owner;
  try {
    owner = payToAddressScript(accountAddress);
  } catch {
    return undefined;
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
  return undefined;
}

/**
 * `matchIsLegacy`, or `flag` when neither derivation matches (the ownership
 * guard then refuses).
 */
export async function resolveIsLegacy(
  accountAddress: string,
  flag: boolean,
  networkId: string,
  firstPublicKey: (isLegacy: boolean) => Promise<string>,
): Promise<boolean> {
  return (
    (await matchIsLegacy(accountAddress, flag, networkId, firstPublicKey)) ??
    flag
  );
}

// A Ledger takes one exchange at a time: resolve once per account, not before
// every signature. Only a match is kept. A rejection (locked keyring) and a
// "neither matched" (a wrong Ledger device) resolve again on the next call,
// so the correct device is found without a reload.
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
    const match = matchIsLegacy(
      accountAddress,
      flag,
      networkId,
      firstPublicKey,
    );
    const forget = () => resolved.delete(key);
    match.then((isLegacy) => isLegacy === undefined && forget(), forget);
    result = match.then((isLegacy) => isLegacy ?? flag);
    resolved.set(key, result);
  }
  return result;
}
