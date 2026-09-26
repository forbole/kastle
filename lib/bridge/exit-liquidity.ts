import { Address } from "@/wasm/core/kaspa";
import type { PublicClient } from "viem";
import { IGRA_EXIT_BRIDGE_ABI } from "@/lib/bridge/igra-exit-abi";

// WHY THIS GATE LOOKS THE WAY IT DOES — the L1 vault is a JIT-refilled hot
// wallet, not a reserve. Its balance at quote time is NOT payout capacity.
// Verified on mainnet 2026-08-26 from the vault's own tx history (UTC):
//   2026-08-25 18:26  cb551d4085  payout leaves vault at    98.42560 KAS
//   2026-08-25 20:03  75a18bc2ac  refill +5,000 KAS ->   5,098.42560 KAS
//   2026-08-25 20:22  9392c1683e  payout  5,088.26378 KAS to a user
// That payout was ~52x the balance the vault held before the refill, so exits
// larger than the instantaneous vault balance settle routinely. Refills come
// from more than one operator-controlled address — that 5,000 arrived from
// kaspa:qq6gfq6n...72j96f5eg, while the 20 KAS refill at 2026-08-26 07:28
// (4d106cd5a3) came from kaspa:qzy6me2q...jh077p3s3 — so total payout capacity
// is not observable from any single address this app could read.
//
// Therefore: never hard-refuse on "vault < requested amount". Refuse only on a
// genuine, persistent inability to pay — the coordinator reporting a shortfall
// against already-committed obligations, or a vault that cannot cover what it
// has already promised. That is the acknowledged-and-unpaid trap this gate
// exists for: lockForExit performs no on-chain L1-liquidity check and KAT's
// relayers acknowledge without checking the vault.
//
// No app-side fee buffer exists on purpose. KAT publishes feeBufferWei itself
// (currently 0) and it is already folded into effectiveLiquidityWei; inventing
// a second buffer here is what refused valid exits.

export const WEI_PER_KAS = 10n ** 18n;
// Kaspa L1 uses 8 decimals (sompi), Igra L2 uses 18 (wei): 1 sompi = 10^10 wei.
export const SOMPI_TO_WEI = 10n ** 10n;

export function sompiToWei(sompi: bigint): bigint {
  return sompi * SOMPI_TO_WEI;
}

/**
 * Vault headroom over already-committed exits, in wei. Negative or zero means
 * the vault cannot cover what it has already promised — the one on-chain
 * condition that genuinely predicts acknowledged-and-unpaid.
 * Null when either source is unavailable — callers must fail OPEN.
 */
export function computeVaultHeadroomWei(
  vaultBalanceSompi: bigint | null,
  pendingExitNetWei: bigint | null,
): bigint | null {
  if (vaultBalanceSompi === null || pendingExitNetWei === null) return null;
  return sompiToWei(vaultBalanceSompi) - pendingExitNetWei;
}

/**
 * capHeadroomKas and maxExitAmountKas are ceilings on the NET amount the
 * contract sees (post-Kastle-fee); gross up before comparing against the
 * user's GROSS balance, or "Max" offers an amount validateAmount then rejects.
 */
export function netCeilingToGrossKas(
  netCeilingKas: number,
  feeRateBps: number,
): number {
  const f = feeRateBps / 10_000;
  if (f >= 1) return 0;
  // floor to 8dp (L1 KAS precision) so float error can't push the grossed-up
  // Max a hair over the ceiling and get it rejected on net.
  return Math.floor((netCeilingKas / (1 - f)) * 1e8) / 1e8;
}

/**
 * Largest exit the user can actually make, in KAS: their balance capped by
 * BOTH protocol ceilings — rolling-cap headroom and maxExitAmount. Either one
 * alone is insufficient: they are independent limits and the smaller binds
 * (mainnet 2026-08-26: headroom 57,679.90 vs maxExitAmount 20,000).
 *
 * Deliberately NOT bounded by the vault balance — that is the JIT hot wallet,
 * and capping on it reintroduces the false negative this module exists to fix.
 *
 * A null ceiling is unknown, not zero: it is skipped rather than collapsing the
 * maximum to 0 while a read is still in flight.
 */
export function computeMaxExitKas(v: {
  balanceKas: number;
  capHeadroomKas: number | null;
  maxExitAmountKas: number | null;
  feeRateBps: number;
}): number {
  return Math.max(
    0,
    Math.min(
      v.balanceKas,
      v.capHeadroomKas !== null
        ? netCeilingToGrossKas(v.capHeadroomKas, v.feeRateBps)
        : Infinity,
      v.maxExitAmountKas !== null
        ? netCeilingToGrossKas(v.maxExitAmountKas, v.feeRateBps)
        : Infinity,
    ),
  );
}

/**
 * Mirror of KasBridge._computeFee: max(net × feePercentBps / 10000, MIN_FEE_FLOOR).
 * Operand is the amount reaching lockForExit (post-FeeCollector net).
 */
export function computeContractFeeWei(
  netWei: bigint,
  feePercentBps: bigint,
  minFeeFloorWei: bigint,
): bigint {
  const percentFee = (netWei * feePercentBps) / 10_000n;
  return percentFee > minFeeFloorWei ? percentFee : minFeeFloorWei;
}

// KAT's own liquidity validator — the same authority kastle-monitoring's
// bridge-liquidity watcher trusts. It publishes the vault address we read, the
// committed obligations, and its own feeBufferWei, already folded into
// effectiveLiquidityWei.
export const COORDINATOR_VALIDATION_URL =
  "https://api.katbridge.com/validation/kas";

// A stale "ok" is worse than no check at all, so anything computed outside this
// window is discarded and the on-chain fallback runs instead. The coordinator
// recomputes per request; the allowance is for transport and clock skew, and is
// applied in both directions because a device clock running fast would
// otherwise make every fresh response look like it came from the future.
export const COORDINATOR_MAX_AGE_MS = 120_000;

export interface CoordinatorLiquidity {
  effectiveLiquidityWei: bigint;
  shortfallWei: bigint;
  computedAtMs: number;
}

export interface ExitGateValues {
  vaultBalanceSompi: bigint | null;
  pendingExitNetWei: bigint | null;
  withinExitCap: boolean | null;
  paused: boolean | null;
  bridgeDisabled: boolean | null;
  coordinator: CoordinatorLiquidity | null;
}

/**
 * Reads KAT's liquidity validator. Returns null on ANY doubt — transport
 * failure, malformed body, missing field, or a computedAt outside
 * COORDINATOR_MAX_AGE_MS — so the caller falls through to the on-chain check.
 * Never throws.
 */
export async function fetchCoordinatorLiquidity(opts: {
  fetchImpl?: typeof fetch;
  now?: number;
  signal?: AbortSignal;
} = {}): Promise<CoordinatorLiquidity | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  try {
    const res = await doFetch(COORDINATOR_VALIDATION_URL, {
      signal: opts.signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const raw = body as Record<string, unknown>;

    const computedAt = Date.parse(String(raw.computedAt ?? ""));
    if (!Number.isFinite(computedAt)) return null;
    if (Math.abs(now - computedAt) > COORDINATOR_MAX_AGE_MS) return null;

    const effectiveLiquidityWei = parseWeiField(raw.effectiveLiquidityWei);
    const shortfallWei = parseWeiField(raw.shortfallWei);
    if (effectiveLiquidityWei === null || shortfallWei === null) return null;

    return { effectiveLiquidityWei, shortfallWei, computedAtMs: computedAt };
  } catch {
    return null;
  }
}

/** Coordinator wei fields are decimal strings; reject anything else. */
function parseWeiField(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

export const EXIT_GATE_MESSAGES = {
  unavailable: "The bridge is temporarily unavailable. Try again later.",
  capFull:
    "The bridge's 24-hour exit limit is currently full. Try again later or use a smaller amount.",
  // Blocking. Only reached once the gate has actually read a shortfall — a
  // drained vault or obligations already exceeding liquidity.
  cannotPayNow:
    "The bridge doesn't have enough KAS right now to complete this. Try again in a few minutes.",
  // Non-blocking notice: the pre-flight could not run and the exit proceeds.
  checkUnavailable:
    "Couldn't check the bridge's liquidity just now. You can go ahead, but it may take a while to complete.",
} as const;

/**
 * ok:true with a notice means the exit proceeds but the pre-flight could not
 * run — the gate is deliberately not blocking on its own blindness.
 */
export type ExitGateResult =
  | { ok: true; notice?: string }
  | { ok: false; message: string };

/**
 * Client-side pre-flight gate for iKAS → KAS exits. lockForExit has no
 * on-chain L1-liquidity check and KAT's relayers acknowledge without checking
 * the vault, so this is the only protection the user gets against an exit that
 * is accepted and then never paid.
 *
 * FAILS OPEN. Every input is read defensively and an unreadable input never
 * blocks: a value we could not fetch is not evidence that the bridge is broken.
 * This does mean the protection is absent during a KAT-side outage — precisely
 * when liquidity is least knowable. Accepted deliberately: refusing valid exits
 * is both the worse failure and, on the evidence of 2026-08-25, the common one.
 *
 * Only definite negatives block. The liquidity decision never compares the
 * requested amount against the vault balance — see the JIT hot-wallet note at
 * the top of this file for why that comparison is invalid.
 */
export function evaluateExitGate(
  v: ExitGateValues,
  now: number = Date.now(),
): ExitGateResult {
  // Hard protocol state. Blocks only when definitively true; null means the
  // read failed and is ignored.
  if (v.paused === true || v.bridgeDisabled === true) {
    return { ok: false, message: EXIT_GATE_MESSAGES.unavailable };
  }
  // Bounds the requested amount against the rolling 24h cap ONLY. Verified on
  // mainnet 2026-08-26: isWithinExitCap flips false at 57,680 KAS, exactly the
  // rolling-cap headroom (rollingExitCap 200,000 − rollingExitTotal
  // 142,320.0986), while isWithinExitCap(20,001e18) is still true against a
  // maxExitAmount of 20,000. It does NOT consult maxExitAmount.
  // maxExitAmount is enforced separately, twice, in useKatIgraToKasBridge:
  // against exitConfig at quote time and against a fresh maxExitAmount() read
  // pre-sign. Do not drop either on the assumption this covers them.
  if (v.withinExitCap === false) {
    return { ok: false, message: EXIT_GATE_MESSAGES.capFull };
  }

  // Authority: KAT's validator, when fresh. Freshness is re-checked HERE and
  // not only at fetch time — the value reaches this function through SWR
  // caches, so a response that was fresh when fetched can be minutes old when
  // acted on. A stale "ok" is worse than no check, so an aged reading is
  // discarded and the on-chain fallback below answers instead.
  if (
    v.coordinator !== null &&
    Math.abs(now - v.coordinator.computedAtMs) <= COORDINATOR_MAX_AGE_MS
  ) {
    const { shortfallWei, effectiveLiquidityWei } = v.coordinator;
    if (shortfallWei > 0n || effectiveLiquidityWei <= 0n) {
      return { ok: false, message: EXIT_GATE_MESSAGES.cannotPayNow };
    }
    return { ok: true };
  }

  // Offline fallback: same question, answered from chain.
  const headroomWei = computeVaultHeadroomWei(
    v.vaultBalanceSompi,
    v.pendingExitNetWei,
  );
  if (headroomWei === null) {
    return { ok: true, notice: EXIT_GATE_MESSAGES.checkUnavailable };
  }
  // ponytail: headroom <= 0 is the whole test — it catches both an empty vault
  // and one already over-committed. A low-but-positive vault is allowed through
  // because the operator refills on demand. Ceiling: this will not catch a
  // vault that is chronically underfunded relative to inbound demand; the
  // coordinator path above is what detects that, and kastle-monitoring alerts
  // on it independently.
  if (headroomWei <= 0n) {
    return { ok: false, message: EXIT_GATE_MESSAGES.cannotPayNow };
  }
  return { ok: true };
}

/**
 * Reads every gating value fresh, from chain and from KAT's validator. Each
 * read fails independently to null so evaluateExitGate sees exactly what is
 * known and treats the rest as unknown rather than as a failure.
 */
export async function readExitGateValues(opts: {
  client: PublicClient;
  bridgeAddress: `0x${string}`;
  netWei: bigint;
  getVaultBalanceSompi: () => Promise<bigint>;
  fetchImpl?: typeof fetch;
}): Promise<ExitGateValues> {
  const { client, bridgeAddress, netWei, getVaultBalanceSompi } = opts;
  const read = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const view = (functionName: string, args?: readonly unknown[]) =>
    client.readContract({
      address: bridgeAddress,
      abi: IGRA_EXIT_BRIDGE_ABI,
      functionName,
      args,
    } as never);

  const [
    vaultBalanceSompi,
    pendingExitNetWei,
    withinExitCap,
    paused,
    bridgeDisabled,
    coordinator,
  ] = await Promise.all([
    read(getVaultBalanceSompi()),
    read(view("pendingExitNet") as Promise<bigint>),
    read(view("isWithinExitCap", [netWei]) as Promise<boolean>),
    read(view("paused") as Promise<boolean>),
    read(view("bridgeDisabled") as Promise<boolean>),
    read(fetchCoordinatorLiquidity({ fetchImpl: opts.fetchImpl })),
  ]);

  return {
    vaultBalanceSompi,
    pendingExitNetWei,
    withinExitCap,
    paused,
    bridgeDisabled,
    coordinator,
  };
}

// Revert reasons from the verified KasBridge/FeeCollector sources → user copy.
// Copy rules: no urgency or fear language; delays framed as safety buffers.
const REVERT_MESSAGE_MAP: [string, string][] = [
  ["Bridge paused", EXIT_GATE_MESSAGES.unavailable],
  ["Bridge disabled", EXIT_GATE_MESSAGES.unavailable],
  ["Exceeds rolling cap", EXIT_GATE_MESSAGES.capFull],
  ["Exceeds max exit", "This amount is above the bridge's maximum exit size. Use a smaller amount."],
  ["Below min exit", "This amount is below the bridge's minimum exit size. Use a larger amount."],
  ["Below minimum fee", "This amount is below the bridge's minimum exit size. Use a larger amount."],
  ["No iKAS sent", "No amount was attached to the exit. Re-enter the amount and try again."],
  ["Kaspa address too long", "The Kaspa payout address is too long for the bridge. Check the address and try again."],
  ["Empty kaspa address", "No Kaspa payout address was provided. Check the address and try again."],
];

/** Maps a send/estimateGas error to cause-specific copy; undefined → caller's generic fallback. */
export function mapExitRevertToMessage(error: unknown): string | undefined {
  const text =
    error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  for (const [needle, message] of REVERT_MESSAGE_MAP) {
    if (text.includes(needle)) return message;
  }
  return undefined;
}

// Kurve (kasplex-kas) bridge minimum exit amount, in KAS.
export const KURVE_MIN_EXIT_KAS = 10;

export function validateKurveExitAmount(amount: number): string | undefined {
  if (amount < KURVE_MIN_EXIT_KAS) {
    return `Oh, minimum bridge amount is ${KURVE_MIN_EXIT_KAS} KAS`;
  }
  return undefined;
}

// KasBridge MAX_KASPA_ADDRESS_LENGTH — bytes accepted by lockForExit.
export const KASPA_ADDRESS_MAX_LENGTH = 100;

/**
 * Full-parse validation of a Kaspa L1 payout address (bech32 via kaspa wasm),
 * plus the contract's prefix/length constraints.
 * Returns an error message, or undefined when valid.
 */
export function validateKaspaPayoutAddress(address: string): string | undefined {
  if (address.length > KASPA_ADDRESS_MAX_LENGTH) {
    return "Invalid Kaspa payout address";
  }
  try {
    // Full bech32 parse — enforces prefix (kaspa/kaspatest), charset and checksum.
    if (!Address.validate(address)) throw new Error("invalid");
  } catch {
    return "Invalid Kaspa payout address";
  }
  return undefined;
}
