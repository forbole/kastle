/// <reference types="vite/client" />

// KRC-20 → KCC-20 migration config. Kat Bridge runs the migration in an external
// web tool; which ticks migrate and where the tool lives both come from the
// PostHog `kcc20_migration` payload. Migratability is only ever what the payload
// says: a kascov ticker that matches a KRC-20 tick is not the same asset.

// Code default for the migration tool. Normally supplied by the payload;
// undefined hides every migration surface.
export const KCC20_MIGRATION_TOOL_URL: string | undefined = undefined;

// Hosts the migration CTA may open. A url passes on an exact hostname match or
// a subdomain of a listed host. Empty means "not yet pinned": any https host
// is accepted.
export const KCC20_MIGRATION_HOST_ALLOWLIST: string[] = [];

// Kat Bridge status API: GET {base}/{revealTxId} for one migration deposit.
export const KCC20_MIGRATION_STATUS_API =
  "https://kcc-api-production.up.railway.app/v1/status";

export type Kcc20MigrationConfig = {
  url: string;
  tokens: { tick: string; covenantId: string }[];
};

export const HEX32 = /^[0-9a-f]{64}$/;

// Parsed token entries are capped at 100: the flag hook re-serialises the
// payload on every render, so an oversized list must not cost O(n) there.
export const MAX_TOKENS = 100;

const warnDropped = (entry: unknown) => {
  if (import.meta.env?.DEV)
    console.warn("kcc20_migration: dropped token entry", entry);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const optString = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The url when it parses as https: and, once KCC20_MIGRATION_HOST_ALLOWLIST is
 * pinned, its hostname is a listed host or a subdomain of one. The tool asks
 * the user to connect this wallet, so http: and unpinned hosts never pass.
 */
function webUrl(v: unknown, allowlist: string[]) {
  const s = optString(v);
  if (!s) return undefined;
  try {
    const { protocol, hostname } = new URL(s);
    if (protocol !== "https:") return undefined;
    const host = hostname.toLowerCase();
    const allowed =
      allowlist.length === 0 ||
      allowlist.some((h) => host === h || host.endsWith(`.${h}`));
    return allowed ? s : undefined;
  } catch {
    return undefined;
  }
}

function parseToken(row: unknown) {
  if (!isRecord(row)) return undefined;
  const tick = optString(row.tick)?.trim();
  const covenantId = optString(row.covenantId);
  if (!tick || !covenantId || !HEX32.test(covenantId)) return undefined;
  return { tick: tick.toUpperCase(), covenantId };
}

/** Malformed entries and any past the first MAX_TOKENS are dropped; undefined when neither the payload nor the fallback gives a usable url. */
export function parseMigrationPayload(
  payload: unknown,
  fallbackUrl?: string,
  allowlist: string[] = KCC20_MIGRATION_HOST_ALLOWLIST,
): Kcc20MigrationConfig | undefined {
  const body = isRecord(payload) ? payload : {};
  const url = webUrl(body.url, allowlist) ?? webUrl(fallbackUrl, allowlist);
  if (!url) return undefined;
  const tokens: Kcc20MigrationConfig["tokens"] = [];
  for (const row of Array.isArray(body.tokens) ? body.tokens : []) {
    const token = tokens.length < MAX_TOKENS ? parseToken(row) : undefined;
    if (token) tokens.push(token);
    else warnDropped(row);
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

export function migratableHeld<T extends { id: string; balance: string }>(
  config: Kcc20MigrationConfig | undefined,
  held: T[],
) {
  return held.filter(
    (t) => isMigratableTick(config, t.id) && positive(t.balance),
  );
}
