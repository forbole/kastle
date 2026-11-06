// Braid swaps in flight, ported from kastle-mobile. Mobile keeps them in
// module scope; a popup that closes loses module scope, and with it the only
// record that a deposit is out, so a second swap could be funded against the
// same pair. Here the state lives in browser.storage.local under
// BRAID_PENDING_KEY and only the settle callbacks stay in memory.
import type {
  BraidL1,
  ChainOutcome,
  PreparedDeposit,
  SwapStatus,
} from "@braid_swap/sdk";

export const BRAID_PENDING_KEY = "braid_pending_swaps";

export const BRAID_POLL_MS = 3_000;
// A swap still open this long after its deposit deadline is left to Activity
// rather than blocking the pair forever.
export const BRAID_SETTLE_GRACE_MS = 60_000;
// Kaspa mainnet DAA score per second.
const DAA_PER_SEC = 10;
// The SDK refuses a deposit whose deadline is more than 20 minutes ahead of
// the public chain (LIM.dlMaxS, @braid_swap/sdk src/l1/constants.js). Not
// exported by the SDK.
const DEPOSIT_DEADLINE_MAX_MS = 20 * 60_000;
// The longest settle window a verified deposit can have.
const SETTLE_WINDOW_MAX_MS = DEPOSIT_DEADLINE_MAX_MS + BRAID_SETTLE_GRACE_MS;

/**
 * A claim lives at most as long as the longest settle window (21 min). A
 * popup closed between claim and register may already have submitted a
 * deposit; while that deposit could still settle, the claim keeps the pair
 * blocked. After that, the claim is dropped on read, so a dead swipe cannot
 * lock the pair forever.
 */
export const BRAID_CLAIM_TTL_MS = SETTLE_WINDOW_MAX_MS;

/**
 * done / refunded only when the public chain shows it; unconfirmed when
 * Braid's claim could not be verified or the poll ran out.
 */
export type BraidSettleState =
  | "done"
  | "refunded"
  | "reclaimed"
  | "expired"
  | "failed"
  | "unconfirmed";

export type BraidSettleDetail = {
  status?: SwapStatus;
  chain?: ChainOutcome;
  error?: unknown;
};

export type BraidSettle = (
  state: BraidSettleState,
  detail: BraidSettleDetail,
) => void;

export type PendingBraidSwap = {
  ref: string;
  pairKey: string;
  prepared: PreparedDeposit;
  startedAt: number;
};

type Claim = { id: string; at: number };

type State = {
  swaps: Record<string, PendingBraidSwap>;
  claims: Record<string, Claim>;
};

type Watch = PendingBraidSwap & { listeners: Set<BraidSettle> };

// ref → the swaps this context polls. Callbacks cannot be stored, so these
// stay in memory; a reopened popup rebuilds them through registerBraidSwap.
const watching = new Map<string, Watch>();
// pairKey → the id of a claim this context wrote, so a release drops only
// its own claim.
const ownClaims = new Map<string, string>();
const watchers = new Set<() => void>();

const notify = () => watchers.forEach((w) => w());

/** How long to wait for Braid's final state: the deposit deadline plus grace. */
export function braidSettleTimeoutMs(prepared: PreparedDeposit): number {
  const daaLeft = Math.max(0, Number(prepared.deadlineDaa) - prepared.chainDaa);
  return (daaLeft / DAA_PER_SEC) * 1000 + BRAID_SETTLE_GRACE_MS;
}

// JSON.stringify throws on a bigint. A PreparedDeposit carries bigints at the
// top level (minOut, midMin, debit, depositFee, braidFeeCap, walletFee,
// deadlineDaa) and inside _ver (the verified terms and transaction amounts,
// which the chain check reads on resume). The replacer turns every bigint
// into { $bigint: "<decimal>" } and the reviver turns it back.
const BIGINT_TAG = "$bigint";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isTime = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function bigintReplacer(_key: string, v: unknown): unknown {
  return typeof v === "bigint" ? { [BIGINT_TAG]: v.toString() } : v;
}

function bigintReviver(_key: string, v: unknown): unknown {
  if (
    isRecord(v) &&
    Object.keys(v).length === 1 &&
    typeof v[BIGINT_TAG] === "string" &&
    /^-?\d+$/.test(v[BIGINT_TAG])
  ) {
    return BigInt(v[BIGINT_TAG]);
  }
  return v;
}

// A record that fails any check is dropped, never thrown: one bad entry must
// not blank the list or lock its pair.
function parseSwap(ref: string, v: unknown): PendingBraidSwap | undefined {
  if (
    !isRecord(v) ||
    typeof v.pairKey !== "string" ||
    !isTime(v.startedAt) ||
    typeof v.prepared !== "string"
  ) {
    return undefined;
  }
  let prepared: unknown;
  try {
    prepared = JSON.parse(v.prepared, bigintReviver);
  } catch {
    return undefined;
  }
  if (
    !isRecord(prepared) ||
    prepared.ref !== ref ||
    typeof prepared.userPublicKey !== "string" ||
    typeof prepared.deadlineDaa !== "bigint" ||
    !isTime(prepared.chainDaa)
  ) {
    return undefined;
  }
  const deposit = prepared as unknown as PreparedDeposit;
  // A window no verified deposit can have would hold the pair indefinitely.
  if (!(braidSettleTimeoutMs(deposit) <= SETTLE_WINDOW_MAX_MS)) {
    return undefined;
  }
  return { ref, pairKey: v.pairKey, startedAt: v.startedAt, prepared: deposit };
}

function parseState(v: unknown): State {
  const state: State = { swaps: {}, claims: {} };
  if (!isRecord(v)) return state;
  if (isRecord(v.swaps)) {
    for (const [ref, raw] of Object.entries(v.swaps)) {
      const swap = parseSwap(ref, raw);
      if (swap) state.swaps[ref] = swap;
    }
  }
  if (isRecord(v.claims)) {
    for (const [pairKey, raw] of Object.entries(v.claims)) {
      if (isRecord(raw) && typeof raw.id === "string" && isTime(raw.at)) {
        state.claims[pairKey] = { id: raw.id, at: raw.at };
      }
    }
  }
  return state;
}

// Drops swaps outside their settle window and claims past their TTL, either
// side of `now`, so a clock that moved back cannot hold a pair either.
function live(state: State, now: number): State {
  for (const [ref, swap] of Object.entries(state.swaps)) {
    if (Math.abs(now - swap.startedAt) >= braidSettleTimeoutMs(swap.prepared)) {
      delete state.swaps[ref];
    }
  }
  for (const [pairKey, claim] of Object.entries(state.claims)) {
    if (Math.abs(now - claim.at) >= BRAID_CLAIM_TTL_MS) {
      delete state.claims[pairKey];
    }
  }
  return state;
}

async function read(): Promise<State> {
  const stored = await browser.storage.local.get(BRAID_PENDING_KEY);
  return live(parseState(stored[BRAID_PENDING_KEY]), Date.now());
}

async function write(state: State): Promise<void> {
  const swaps: Record<string, unknown> = {};
  for (const { ref, pairKey, startedAt, prepared } of Object.values(
    state.swaps,
  )) {
    swaps[ref] = {
      pairKey,
      startedAt,
      prepared: JSON.stringify(prepared, bigintReplacer),
    };
  }
  await browser.storage.local.set({
    [BRAID_PENDING_KEY]: { swaps, claims: state.claims },
  });
}

let queue: Promise<unknown> = Promise.resolve();

// One read-modify-write at a time. The Web Locks API spans every extension
// context on the origin (popup, tab, service worker); without it, a promise
// chain still orders the writes of this context.
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(BRAID_PENDING_KEY, fn) as Promise<T>;
  }
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
}

function update<T>(fn: (state: State, now: number) => T): Promise<T> {
  return exclusive(async () => {
    const state = await read();
    const out = fn(state, Date.now());
    await write(state);
    return out;
  });
}

const hasPair = (state: State, pairKey: string) =>
  Object.values(state.swaps).some((s) => s.pairKey === pairKey);

const verdict = (status: SwapStatus, chain: ChainOutcome): BraidSettleState => {
  if (chain.verified && chain.outcome === "delivered") return "done";
  if (chain.verified && chain.outcome === "refunded") return "refunded";
  // Braid's word alone never makes a done or a refund.
  if (["reclaimed", "expired", "failed"].includes(status.state)) {
    return status.state as BraidSettleState;
  }
  return "unconfirmed";
};

async function poll(watch: Watch, braid: BraidL1) {
  const { ref, prepared, startedAt } = watch;
  let state: BraidSettleState = "unconfirmed";
  let detail: BraidSettleDetail = {};
  try {
    const status = await braid.waitForResult(ref, {
      userPublicKey: prepared.userPublicKey,
      intervalMs: BRAID_POLL_MS,
      // What is left of the window: a resumed swap does not start it again.
      timeoutMs: Math.max(
        0,
        startedAt + braidSettleTimeoutMs(prepared) - Date.now(),
      ),
    });
    detail = { status };
    const chain = await braid.waitOutcome(prepared, status, {
      intervalMs: BRAID_POLL_MS,
    });
    detail = { status, chain };
    state = verdict(status, chain);
  } catch (error) {
    detail = { ...detail, error };
  }
  // Cleared meanwhile: nobody is waiting on this swap any more.
  if (watching.get(ref) !== watch) return;
  watching.delete(ref);
  // Removing the entry releases the pair: registering already dropped the
  // swipe's claim. A failed write leaves the entry to expire with its window;
  // the callbacks still run.
  await update((s) => {
    if (s.swaps[ref]?.startedAt === startedAt) delete s.swaps[ref];
  }).catch(() => undefined);
  notify();
  watch.listeners.forEach((settle) => {
    try {
      settle(state, detail);
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * Tracks a submitted (or possibly submitted) deposit until it settles.
 * Registering a ref already in flight only adds `onSettle` to it. Each
 * callback runs once, with the final state. A reopened popup resumes a
 * stored swap by registering it again: the stored start time is kept.
 */
export async function registerBraidSwap({
  ref,
  prepared,
  pairKey,
  onSettle,
  braid,
}: {
  ref: string;
  prepared: PreparedDeposit;
  pairKey: string;
  onSettle: BraidSettle;
  braid: BraidL1;
}): Promise<void> {
  ownClaims.delete(pairKey);
  // The deposit now holds the pair in place of the swipe's claim, in one
  // write. If the write fails the claim stays, so the pair stays blocked
  // until the claim's TTL; the swap is still watched here.
  const startedAt = await update((s, now) => {
    delete s.claims[pairKey];
    const stored = s.swaps[ref];
    if (stored) return stored.startedAt;
    s.swaps[ref] = { ref, pairKey, prepared, startedAt: now };
    return now;
  }).catch(() => Date.now());
  const existing = watching.get(ref);
  if (existing) {
    existing.listeners.add(onSettle);
    return;
  }
  const watch: Watch = {
    ref,
    pairKey,
    prepared,
    startedAt,
    listeners: new Set([onSettle]),
  };
  watching.set(ref, watch);
  notify();
  void poll(watch, braid);
}

export async function isBraidPending(pairKey: string): Promise<boolean> {
  return hasPair(await read(), pairKey);
}

/**
 * Reserves the pair for one swipe, from before the biometric to the submit.
 * False while another swipe holds it or a deposit on it is still settling.
 */
export async function claimBraidPair(pairKey: string): Promise<boolean> {
  const id = crypto.randomUUID();
  const written = await update((s, now) => {
    if (s.claims[pairKey] || hasPair(s, pairKey)) return false;
    s.claims[pairKey] = { id, at: now };
    return true;
  });
  if (!written) return false;
  // A context without the lock may have written over us between the get and
  // the set: the claim counts only if it reads back as ours.
  if ((await read()).claims[pairKey]?.id !== id) return false;
  ownClaims.set(pairKey, id);
  return true;
}

/** Ends a swipe that sent nothing; a registered deposit already replaced it. */
export async function releaseBraidPair(pairKey: string): Promise<void> {
  const id = ownClaims.get(pairKey);
  if (!id) return;
  ownClaims.delete(pairKey);
  await update((s) => {
    if (s.claims[pairKey]?.id === id) delete s.claims[pairKey];
  });
}

/** Forgets a swap; its poll may finish but calls nobody. */
export async function clearBraidSwap(ref: string): Promise<void> {
  const watched = watching.delete(ref);
  const stored = await update((s) => {
    const had = ref in s.swaps;
    delete s.swaps[ref];
    return had;
  });
  if (watched || stored) notify();
}

/** The stored swaps still inside their settle window. */
export async function getPendingBraidSwaps(): Promise<PendingBraidSwap[]> {
  return Object.values((await read()).swaps);
}

/** Calls `fn` whenever a swap is registered or settles. */
export function subscribeBraidSwaps(fn: () => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}
