// Activity feed row model. Pure types — no React, no network.
//
// Status tokens are OPAQUE to this layer: the visual PR decides how each one
// renders. This layer only guarantees which token + actions a row carries.

export type ActivityStatusToken =
  | "completed"
  | "failed"
  | "submitted"
  | "pending"
  | "refund_claimable"
  | "acknowledged"
  | "eligibility_unknown"
  | "unknown";

export type ActivityActionId = "claim_refund";

export interface ActivityAmount {
  /** Decimal string in display units (KAS, not wei/sompi). */
  value: string;
  symbol: string;
}

export type ActivityDirection = "in" | "out" | "swap";

export interface ActivityRowDescriptor {
  id: string;
  /** Registry key of the mapper that produced this row. */
  type: string;
  timestampMs: number;
  direction: ActivityDirection;
  sent?: ActivityAmount;
  received?: ActivityAmount;
  status: ActivityStatusToken;
  /** Only actions that are safe to execute. Empty = row is display-only. */
  actions: ActivityActionId[];
  /** Extra key/value context for the detail sheet (txHash, exitId, …). */
  meta?: Record<string, string>;
}

/** A domain object tagged with the mapper that understands it. */
export interface ActivitySourceItem<T = unknown> {
  type: string;
  data: T;
}
