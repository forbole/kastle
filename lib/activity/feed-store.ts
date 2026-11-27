import { useEffect, useState } from "react";
import { storage } from "wxt/storage";

/**
 * The last activity the popup showed, so the next open paints it at once
 * while the live read runs (the refresh spinner says it is running). Mainnet
 * only, like the feed. Values may carry bigint, which storage's JSON drops,
 * so they are stored as tagged JSON text.
 */
const key = (kind: "feed" | "kcc20", id: string) =>
  `local:cache:activity:${kind}:${id}` as const;

const BIG = "__bigint";

export function encodeStored(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    typeof v === "bigint" ? { [BIG]: v.toString() } : v,
  );
}

export function decodeStored<T>(text: string): T {
  return JSON.parse(text, (_, v) =>
    v && typeof v === "object" && typeof v[BIG] === "string"
      ? BigInt(v[BIG])
      : v,
  ) as T;
}

export async function loadStoredActivity<T>(
  kind: "feed" | "kcc20",
  id: string,
): Promise<T | undefined> {
  const text = await storage.getItem<string>(key(kind, id));
  return text ? decodeStored<T>(text) : undefined;
}

// What this popup last wrote per key, so an unchanged poll writes nothing.
const written = new Map<string, string>();

/** Best effort: a failed write leaves the previous copy, never fails a read. */
export function storeActivity(
  kind: "feed" | "kcc20",
  id: string,
  value: unknown,
): void {
  const k = key(kind, id);
  const text = encodeStored(value);
  if (written.get(k) === text) return;
  written.set(k, text);
  void storage.setItem(k, text).catch(() => written.delete(k));
}

/** The copy stored under `id` (undefined while reading, or none stored). */
export function useStoredActivity<T>(
  kind: "feed" | "kcc20",
  id: string | undefined,
): T | undefined {
  const [stored, setStored] = useState<{ id: string; value?: T }>();
  useEffect(() => {
    if (!id || stored?.id === id) return;
    let active = true;
    loadStoredActivity<T>(kind, id)
      .catch(() => undefined)
      .then((value) => {
        if (active) setStored({ id, value });
      });
    return () => {
      active = false;
    };
  }, [kind, id, stored]);
  // Only the copy stored under this id may stand in.
  return id && stored?.id === id ? stored.value : undefined;
}
