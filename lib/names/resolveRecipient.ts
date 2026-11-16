import { Address } from "@/wasm/core/kaspa";
import { getDotk, isDotkName } from "@/lib/dotk/client";

// NetworkType (contexts/SettingsContext.tsx) -> the WASM address prefix.
// ponytail: only the enum's members; any other id skips the local check.
const PREFIX: Record<string, string> = {
  mainnet: "kaspa:",
  "testnet-10": "kaspatest:",
};

type FetchDomainInfo = (
  domain: string,
) => Promise<{ data?: { owner?: string } } | undefined>;

export type ResolvedRecipient = {
  /** Always a valid Kaspa address when set. */
  address?: string;
  /** The name the user typed, when it resolved from one. */
  domain?: string;
  /** Why the input was refused, when a name had a definite reason. */
  fault?: string;
};

/**
 * The one send-field resolver: `.kas` -> KNS, `.k` -> dotK, else a raw address.
 * A send must be refused unless `address` is set; `fault` explains a refusal.
 */
export async function resolveRecipient(
  input: string,
  {
    fetchDomainInfo,
    networkId,
    dotk,
  }: { fetchDomainInfo: FetchDomainInfo; networkId?: string; dotk: boolean },
): Promise<ResolvedRecipient> {
  input = input.trim();
  const id = (networkId ?? "").trim().toLowerCase();
  // Address.validate is network-agnostic; a foreign prefix only fails later,
  // inside createTransactions at Confirm (KASTLE-T). An id outside PREFIX is
  // not refused here: the WASM still decides, as before this guard.
  const prefix = PREFIX[id];
  const onNetwork = (addr: string) => !prefix || addr.startsWith(prefix);
  const wrongNetwork = { fault: "This address belongs to a different network" };

  if (input.endsWith(".kas")) {
    const owner = (await fetchDomainInfo(input))?.data?.owner;
    if (!owner || !Address.validate(owner)) return {};
    return onNetwork(owner) ? { address: owner, domain: input } : wrongNetwork;
  }

  if (dotk && isDotkName(input)) {
    const recipient = await getDotk(id).recipientFor(input);
    if (
      recipient.kind === "address" ||
      recipient.kind === "neither" ||
      !recipient.address ||
      recipient.fault ||
      !Address.validate(recipient.address)
    ) {
      const fault =
        "fault" in recipient && recipient.fault === "unresolved"
          ? "This name is not registered yet or cannot be resolved now"
          : "fault" in recipient
            ? recipient.fault
            : undefined;
      return { fault };
    }
    if (!onNetwork(recipient.address)) return wrongNetwork;
    return { address: recipient.address, domain: input };
  }

  if (!Address.validate(input)) return {};
  return onNetwork(input) ? { address: input } : wrongNetwork;
}
