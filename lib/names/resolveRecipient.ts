import { Address } from "@/wasm/core/kaspa";
import { getDotk, isDotkName } from "@/lib/dotk/client";

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
  }: { fetchDomainInfo: FetchDomainInfo; networkId: string; dotk: boolean },
): Promise<ResolvedRecipient> {
  if (input.endsWith(".kas")) {
    const owner = (await fetchDomainInfo(input))?.data?.owner;
    return owner && Address.validate(owner)
      ? { address: owner, domain: input }
      : {};
  }

  if (dotk && isDotkName(input)) {
    const recipient = await getDotk(networkId).recipientFor(input);
    if (
      recipient.kind === "address" ||
      recipient.kind === "neither" ||
      !recipient.address ||
      recipient.fault ||
      !Address.validate(recipient.address)
    ) {
      return { fault: "fault" in recipient ? recipient.fault : undefined };
    }
    return { address: recipient.address, domain: input.trim() };
  }

  return Address.validate(input) ? { address: input } : {};
}
