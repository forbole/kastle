import { createPublicClient, http, parseAbi, zeroAddress } from "viem";
import { igraMainnet } from "@/lib/layer2";

// INS registries on Igra mainnet (38833). Both are verified on
// explorer.igralabs.com. V2 stores v1Registry() but never reads it, so the
// V2 -> V1 fallthrough has to happen caller-side.
export const INS_V2_REGISTRY =
  "0x7E7018959bf44045F01D176D8db1594894CBf4E9" as const;
export const INS_V1_REGISTRY =
  "0x42c2f5AA0c4aACfD07e5fBe65B898212c1c2879c" as const;

export type InsRegistryVersion = "v1" | "v2";

// V1 (INSRegistryIgra) has no expiry at all -- no isExpired, no isInGrace, no
// expiresAt, only mintedAt. Calling the V2 expiry getters against V1 reverts,
// so the two registries need separate ABIs or every V1 name fails closed.
const V2_ABI = parseAbi([
  "function tokenIdOf(string) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function isExpired(uint256) view returns (bool)",
  "function isInGrace(uint256) view returns (bool)",
]);

const V1_ABI = parseAbi([
  "function tokenIdOf(string) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
]);

// targetOf/setTarget are the routing pointer, separate from ownership. Both
// are present and behave identically on V1 and V2 (gas-estimated against both:
// setTarget from the owner succeeds, from a non-owner it reverts), so unlike
// the expiry getters they do not need per-version ABIs.
export const TARGET_ABI = parseAbi([
  "function targetOf(uint256) view returns (address)",
  "function setTarget(string,address)",
]);

// Per-request ceiling. viem's http transport defaults to retryCount: 3, which
// would turn this into 4 attempts (~41s) on a blackholed RPC, so retries are
// off and the overall deadline below is what actually bounds the lookup.
const RPC_TIMEOUT_MS = 10_000;

// Whole-lookup ceiling. A lookup is up to 4 sequential round trips (Multicall3
// is NOT deployed on 38833 -- no bytecode at 0xcA11...CA11), and the per-call
// timeout alone cannot bound the total, so the deadline is enforced here.
const LOOKUP_DEADLINE_MS = 15_000;

const client = createPublicClient({
  chain: igraMainnet,
  transport: http(igraMainnet.rpcUrls.default.http[0], {
    timeout: RPC_TIMEOUT_MS,
    retryCount: 0,
  }),
});

export { client as insRpcClient };

/**
 * Contract calls key off the bare label -- tokenIdOf("satoshi") returns 39
 * while tokenIdOf("satoshi.igra") returns 0. The REST API accepts either.
 */
export function toInsLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.igra$/, "");
}

export function isInsName(value: string): boolean {
  return /^[^\s.]+\.igra$/.test(value.trim().toLowerCase());
}

export type InsOnChainResult =
  | {
      ok: true;
      /** The current owner. This is the send destination. */
      address: `0x${string}`;
      tokenId: bigint;
      registry: `0x${string}`;
      version: InsRegistryVersion;
      inGrace: boolean;
    }
  | { ok: false; reason: string };

async function lookupIn(
  registry: `0x${string}`,
  version: InsRegistryVersion,
  label: string,
): Promise<InsOnChainResult | null> {
  const abi = version === "v2" ? V2_ABI : V1_ABI;

  const tokenId = await client.readContract({
    address: registry,
    abi,
    functionName: "tokenIdOf",
    args: [label],
  });

  // 0 means "not in this registry" -- caller falls through to the next one.
  if (tokenId === 0n) return null;

  const address = await client.readContract({
    address: registry,
    abi,
    functionName: "ownerOf",
    args: [tokenId],
  });

  // ownerOf reverts for a burned id in practice, so this is belt-and-braces --
  // but it is one line on a send path and the zero address is never a
  // destination anyone means to fund.
  if (address === zeroAddress) {
    return { ok: false, reason: `${label}.igra has no owner.` };
  }

  let inGrace = false;
  if (version === "v2") {
    const [expired, grace] = [
      await client.readContract({
        address: registry,
        abi: V2_ABI,
        functionName: "isExpired",
        args: [tokenId],
      }),
      await client.readContract({
        address: registry,
        abi: V2_ABI,
        functionName: "isInGrace",
        args: [tokenId],
      }),
    ];

    // Neither ownerOf nor resolve checks expiry, so a lapsed name keeps
    // returning its old owner. Past grace the name can be re-registered by
    // anyone, so that owner is not a safe destination.
    if (expired && !grace) {
      return {
        ok: false,
        reason: "This name has expired and is past its grace period.",
      };
    }
    inGrace = grace;
  }

  return { ok: true, address, tokenId, registry, version, inGrace };
}

/**
 * Resolve a .igra name to the address funds should actually go to.
 *
 * Deliberately does NOT use resolve()/targetOf: those are a routing pointer
 * that transferFrom never updates, so after a transfer they keep returning the
 * previous owner. ownerOf is the ground truth.
 *
 * Fails closed -- any RPC error, timeout, missing name or lapsed name returns
 * ok:false and the caller must block the send.
 */
export async function lookupInsNameOnChain(
  name: string,
): Promise<InsOnChainResult> {
  const label = toInsLabel(name);
  if (!label) return { ok: false, reason: "Enter a name." };

  const deadline = new Promise<InsOnChainResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: false,
          reason: "Could not verify this name on-chain. Try again.",
        }),
      LOOKUP_DEADLINE_MS,
    ),
  );

  const lookup = (async (): Promise<InsOnChainResult> => {
    try {
      const v2 = await lookupIn(INS_V2_REGISTRY, "v2", label);
      if (v2) return v2;

      const v1 = await lookupIn(INS_V1_REGISTRY, "v1", label);
      if (v1) return v1;

      return { ok: false, reason: `${label}.igra is not registered.` };
    } catch (error) {
      console.error("INS on-chain lookup failed", error);
      return {
        ok: false,
        reason: "Could not verify this name on-chain. Try again.",
      };
    }
  })();

  return Promise.race([lookup, deadline]);
}

/**
 * The address a name currently routes funds to. Separate from ownership:
 * transferFrom never touches it, so after a transfer it still points at the
 * previous owner until someone calls setTarget.
 */
export async function getInsTarget(
  registry: `0x${string}`,
  tokenId: bigint,
): Promise<`0x${string}` | undefined> {
  try {
    return await client.readContract({
      address: registry,
      abi: TARGET_ABI,
      functionName: "targetOf",
      args: [tokenId],
    });
  } catch (error) {
    console.error("INS targetOf failed", error);
    return undefined;
  }
}
