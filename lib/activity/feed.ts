import {
  ActivityRowDescriptor,
  ActivitySourceItem,
} from "@/lib/activity/types";

// Mapper registry: adding a future row type (e.g. covenant / KCC-20 transfer)
// is one registerActivityMapper() call in its own module — no changes here or
// in the feed/screen.

export type ActivityMapperFn<T> = (data: T) => ActivityRowDescriptor;

const registry = new Map<string, ActivityMapperFn<never>>();

export function registerActivityMapper<T>(
  type: string,
  map: ActivityMapperFn<T>,
): void {
  registry.set(type, map as ActivityMapperFn<never>);
}

/**
 * Map + sort (newest first). Items with no registered mapper, or whose mapper
 * throws, are dropped — a bad item must never break the whole feed.
 */
export function assembleActivityFeed(
  items: ActivitySourceItem[],
): ActivityRowDescriptor[] {
  const rows: ActivityRowDescriptor[] = [];
  for (const item of items) {
    const map = registry.get(item.type);
    if (!map) continue;
    try {
      rows.push(map(item.data as never));
    } catch {
      // Silently dropped; add per-row error reporting if support needs it
    }
  }
  return rows.sort((a, b) => b.timestampMs - a.timestampMs);
}
