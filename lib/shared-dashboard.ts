import { readVersioned, storageKeys, writeVersioned } from './storage';

export const sharedDashboardKeys = [
  storageKeys.currencyRows,
  storageKeys.currencyRate,
  storageKeys.productIncreases,
  storageKeys.sellingEntries,
  storageKeys.productCategories,
] as const;
export type SharedDashboardKey = typeof sharedDashboardKeys[number];

const saveQueue = new Map<SharedDashboardKey, Promise<void>>();

export async function loadSharedDashboardValue<T>(
  key: SharedDashboardKey,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const cached = readVersioned(key, validate);
  const response = await fetch(`/api/shared-dashboard?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  const result = await response.json() as { value?: unknown; error?: string };
  if (!response.ok) throw new Error(result.error || 'Shared company data is unavailable.');
  if (result.value === null || result.value === undefined) {
    if (cached !== null) await saveSharedDashboardValue(key, cached);
    return cached;
  }
  if (!validate(result.value)) throw new Error('Shared company data failed validation.');
  // An existing remote snapshot is authoritative. A stale tab-local snapshot
  // must never resurrect deleted rows or replace a newer server value. Keep a
  // recovery copy of non-empty divergent browser data before refreshing cache.
  if (cached !== null && JSON.stringify(cached) !== JSON.stringify(result.value)) {
    const hasLocalData = Array.isArray(cached) ? cached.length > 0 : cached !== null;
    if (hasLocalData) writeVersioned(`ellextstore:recovery:v1:${key}`, cached);
  }
  writeVersioned(key, result.value);
  return result.value;
}

export function saveSharedDashboardValue(key: SharedDashboardKey, value: unknown): Promise<void> {
  writeVersioned(key, value);
  const previous = saveQueue.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const response = await fetch('/api/shared-dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error || 'Could not sync company data.');
    }
  });
  saveQueue.set(key, next);
  return next.finally(() => { if (saveQueue.get(key) === next) saveQueue.delete(key); });
}
