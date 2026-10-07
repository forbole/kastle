import { Dotk } from "@dotk/sdk";

// One instance per network. No node attached in v1: results are API-only
// (`proven` stays null), which the read-only surfaces never present as proof.
const instances = new Map<string, Dotk>();

export function getDotk(networkId: string): Dotk {
  let dotk = instances.get(networkId);
  if (!dotk) {
    dotk = new Dotk({ network: networkId });
    instances.set(networkId, dotk);
  }
  return dotk;
}

// `classify` treats any bare [a-z0-9-] string as a name, so only an explicit
// `.k` suffix may route to dotK. `.kas` does not match: it ends in "s".
export const isDotkName = (input: string) => /\.k$/i.test(input.trim());
