import { readVersioned, storageKeys, writeVersioned } from './storage';

export const sharedDashboardKeys = [
  storageKeys.currencyRows,
  storageKeys.currencyRate,
  storageKeys.productIncreases,
  storageKeys.sellingEntries,
  storageKeys.productCategories,
] as const;
export type SharedDashboardKey = typeof sharedDashboardKeys[number];

const saveQueue = new Map<SharedDashboardKey, Promise<'supabase' | 'sqlite'>>();
const revisions = new Map<SharedDashboardKey, string | null>();

function preserveForRecovery(key: SharedDashboardKey, value: unknown) {
  // Keep a dated, non-overwriting recovery copy. Never promote browser data
  // into the shared store just because the server has no snapshot.
  const timestamp = Date.now();
  let suffix = 0;
  let storageKey = `ellextstore:recovery:v1:${key}:${timestamp}`;
  try {
    while (window.localStorage.getItem(storageKey) !== null) {
      storageKey = `ellextstore:recovery:v1:${key}:${timestamp}:${++suffix}`;
    }
  } catch { return; }
  writeVersioned(storageKey, value);
}

export async function loadSharedDashboardValue<T>(
  key: SharedDashboardKey,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  const cached = readVersioned(key, validate);
  let response: Response;
  try {
    response = await fetch(`/api/shared-dashboard?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  } catch (error) {
    if (cached !== null) preserveForRecovery(key, cached);
    throw error;
  }
  const result = await response.json().catch(() => ({})) as { value?: unknown; revision?: string | null; error?: string };
  if (!response.ok) {
    if (cached !== null) preserveForRecovery(key, cached);
    throw new Error(result.error || 'Shared company data is unavailable.');
  }
  revisions.set(key, typeof result.revision === 'string' ? result.revision : null);
  if (result.value === null || result.value === undefined) {
    if (cached !== null) {
      preserveForRecovery(key, cached);
      const hasLocalData = Array.isArray(cached) ? cached.length > 0 : cached !== null;
      if (hasLocalData) throw new Error('No shared snapshot exists yet. This browser’s saved records were preserved for recovery and were not uploaded.');
    }
    return null;
  }
  if (!validate(result.value)) {
    if (cached !== null) preserveForRecovery(key, cached);
    throw new Error('Shared company data failed validation.');
  }
  // An existing remote snapshot is authoritative. A stale tab-local snapshot
  // must never resurrect deleted rows or replace a newer server value. Keep a
  // recovery copy of non-empty divergent browser data before refreshing cache.
  if (cached !== null && JSON.stringify(cached) !== JSON.stringify(result.value)) {
    const hasLocalData = Array.isArray(cached) ? cached.length > 0 : cached !== null;
    if (hasLocalData) preserveForRecovery(key, cached);
  }
  writeVersioned(key, result.value);
  return result.value;
}

export function saveSharedDashboardValue(key: SharedDashboardKey, value: unknown): Promise<'supabase' | 'sqlite'> {
  const previous = saveQueue.get(key) ?? Promise.resolve<'supabase' | 'sqlite'>('supabase');
  const next = previous.catch(() => {}).then(async () => {
    try {
      const response = await fetch('/api/shared-dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value, revision: revisions.get(key) ?? null }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; storageMode?: 'supabase' | 'sqlite'; revision?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Could not sync company data.');
      }
      revisions.set(key, typeof result.revision === 'string' ? result.revision : null);
      writeVersioned(key, value);
      return result.storageMode === 'sqlite' ? 'sqlite' : 'supabase';
    } catch (error) {
      preserveForRecovery(key, value);
      throw error;
    }
  });
  saveQueue.set(key, next);
  return next.finally(() => { if (saveQueue.get(key) === next) saveQueue.delete(key); });
}
