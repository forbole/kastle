// lib/wallet/resolve-derivation, unchanged, unless the harness state asks for
// the pre-fix selection: then the signer hooks get the raw wallet flag
// (`isLegacyWalletEnabled ?? false`), as they did before 10e0bc6.
import * as real from "../../lib/wallet/resolve-derivation";
import { getState } from "./stubs";

export * from "../../lib/wallet/resolve-derivation";

export const resolveAccountIsLegacy: typeof real.resolveAccountIsLegacy = (
  ...args
) =>
  getState().preFix
    ? Promise.resolve(args[3])
    : real.resolveAccountIsLegacy(...args);
