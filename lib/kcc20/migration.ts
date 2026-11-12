// KRC-20 → KCC-20 migration config, ported from mobile. Kat Bridge runs the
// migration in an external web tool; which ticks migrate and where the tool
// lives both come from the PostHog `kcc20_migration` payload. Nothing here is
// hard-coded: no payload, no config, no migrate entry.

export type Kcc20MigrationErc20 = { chainId: number; address: string };

/** `erc20` is present only when the payload row carries the field. */
export type Kcc20MigrationToken = {
  tick: string;
  covenantId: string;
  erc20?: Kcc20MigrationErc20[];
};

export type Kcc20MigrationConfig = {
  url: string;
  tokens: Kcc20MigrationToken[];
};

// The tool signs through window.kastle, so only pinned hosts may be opened.
const HOST_ALLOWLIST = ["katbridge.com"];
const HEX32 = /^[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// An oversized payload must not cost O(n) on every render of every consumer.
export const MAX_MIGRATION_TOKENS = 100;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const optString = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The parsed href when the url is https: on katbridge.com or a subdomain of
 * it, without credentials. The normalized href, never the raw payload string,
 * is what reaches the browser.
 */
export function webUrl(v: unknown) {
  const s = optString(v);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    return HOST_ALLOWLIST.some((h) => host === h || host.endsWith(`.${h}`))
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function parseErc20(entry: unknown): Kcc20MigrationErc20 | undefined {
  if (!isRecord(entry)) return undefined;
  const { chainId } = entry;
  const address = optString(entry.address);
  if (
    typeof chainId !== "number" ||
    !Number.isSafeInteger(chainId) ||
    chainId < 1
  )
    return undefined;
  if (!address || !EVM_ADDRESS.test(address)) return undefined;
  return { chainId, address: address.toLowerCase() };
}

function parseToken(row: unknown): Kcc20MigrationToken | undefined {
  if (!isRecord(row)) return undefined;
  const tick = optString(row.tick)?.trim();
  const covenantId = optString(row.covenantId);
  if (!tick || !covenantId || !HEX32.test(covenantId)) return undefined;
  const token: Kcc20MigrationToken = { tick: tick.toUpperCase(), covenantId };
  if (!("erc20" in row)) return token;
  // A bad entry drops alone; the row (and its L1 migration) survives.
  token.erc20 = [];
  for (const entry of Array.isArray(row.erc20) ? row.erc20 : []) {
    const erc20 = parseErc20(entry);
    if (erc20) token.erc20.push(erc20);
  }
  return token;
}

/** Malformed rows and any past the first MAX_MIGRATION_TOKENS are dropped; undefined without a usable url. */
export function parseMigrationPayload(
  payload: unknown,
): Kcc20MigrationConfig | undefined {
  // posthog-js may hand the payload over as a JSON string.
  let body: unknown = payload;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(body)) return undefined;
  const url = webUrl(body.url);
  if (!url) return undefined;
  const tokens: Kcc20MigrationToken[] = [];
  for (const row of Array.isArray(body.tokens) ? body.tokens : []) {
    if (tokens.length >= MAX_MIGRATION_TOKENS) break;
    const token = parseToken(row);
    if (token) tokens.push(token);
  }
  return { url, tokens };
}

export function isMigratableTick(
  config: Kcc20MigrationConfig | undefined,
  tokenId: string | undefined,
) {
  if (!config || !tokenId) return false;
  const tick = tokenId.toUpperCase();
  return config.tokens.some((t) => t.tick === tick);
}

const positive = (balance: string) => {
  try {
    return BigInt(balance) > 0n;
  } catch {
    return false;
  }
};

/** Held KRC-20 tokens the payload lists, with a positive balance. */
export function migratableHeld<T extends { id: string; balance: string }>(
  config: Kcc20MigrationConfig | undefined,
  held: T[],
) {
  return held.filter(
    (t) => isMigratableTick(config, t.id) && positive(t.balance),
  );
}

/**
 * The url the Bridge migrate row opens, or undefined when the row is hidden:
 * the migration is active and the wallet holds a payload-listed KRC-20.
 */
export function migrationRowUrl(migration: {
  enabled: boolean;
  config?: Kcc20MigrationConfig;
  migratableHeld: unknown[];
}) {
  return migration.enabled && migration.migratableHeld.length > 0
    ? migration.config?.url
    : undefined;
}
