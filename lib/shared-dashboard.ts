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

function mergeSharedValue<T>(key: SharedDashboardKey, cached: T | null, shared: T): T {
  if (cached === null) return shared;
  if (key === storageKeys.currencyRate) {
    const localDate = Date.parse((cached as { updatedAt?: string })?.updatedAt || '');
    const sharedDate = Date.parse((shared as { updatedAt?: string })?.updatedAt || '');
    return Number.isFinite(localDate) && localDate > sharedDate ? cached : shared;
  }
  if (Array.isArray(cached) && Array.isArray(shared)) {
    if (key === storageKeys.productCategories) return Array.from(new Set([...cached, ...shared])) as T;
    const idField = key === storageKeys.currencyRows ? 'id' : 'sourceId';
    const merged = new Map<string, unknown>();
    for (const item of cached) if (item && typeof item === 'object' && typeof item[idField] === 'string') merged.set(item[idField], item);
    for (const item of shared) if (item && typeof item === 'object' && typeof item[idField] === 'string') merged.set(item[idField], item);
    return Array.from(merged.values()) as T;
  }
  return shared;
}

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
  const merged = mergeSharedValue(key, cached, result.value);
  writeVersioned(key, merged);
  if (JSON.stringify(merged) !== JSON.stringify(result.value)) await saveSharedDashboardValue(key, merged);
  return merged;
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
