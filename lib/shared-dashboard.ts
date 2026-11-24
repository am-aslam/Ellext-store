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
const sharedReadQueue = new Map<string, Promise<unknown>>();

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

async function fetchSharedDashboardValue<T>(
  key: SharedDashboardKey,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T | null> {
  const cached = readVersioned(key, validate);
  let response: Response;
  try {
    response = await fetch(`/api/shared-dashboard?key=${encodeURIComponent(key)}`, { cache: 'no-store', signal });
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

export function loadSharedDashboardValue<T>(
  key: SharedDashboardKey,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T | null> {
  const pending = sharedReadQueue.get(key) as Promise<T | null> | undefined;
  if (pending) return pending;
  const request = fetchSharedDashboardValue(key, validate, signal);
  sharedReadQueue.set(key, request);
  return request.finally(() => { if (sharedReadQueue.get(key) === request) sharedReadQueue.delete(key); });
}

export async function loadSharedDashboardValues(
  validators: Partial<Record<SharedDashboardKey, (value: unknown) => value is unknown>>,
  signal?: AbortSignal,
  retryCount = 0,
): Promise<Partial<Record<SharedDashboardKey, unknown | null>>> {
  const keys = Object.keys(validators) as SharedDashboardKey[];
  const cacheKey = keys.slice().sort().join('|');
  const pending = sharedReadQueue.get(cacheKey) as Promise<Partial<Record<SharedDashboardKey, unknown | null>>> | undefined;
  if (pending) return pending;
  const request = (async () => {
    let response: Response;
    try {
      response = await fetch(`/api/shared-dashboard?keys=${keys.map(encodeURIComponent).join(',')}&attempt=${retryCount}`, { cache: 'no-store', signal });
    } catch (error) {
      for (const key of keys) { const validate = validators[key]; if (validate) { const cached = readVersioned(key, validate); if (cached !== null) preserveForRecovery(key, cached); } }
      throw error;
    }
    const result = await response.json().catch(() => ({})) as { snapshots?: Record<string, { value?: unknown; revision?: string | null }>; error?: string };
    if (!response.ok || !result.snapshots) {
      for (const key of keys) { const validate = validators[key]; if (validate) { const cached = readVersioned(key, validate); if (cached !== null) preserveForRecovery(key, cached); } }
      const requestId = response.headers.get('x-request-id') || (result as { requestId?: string }).requestId;
      throw new Error(`${result.error || 'Shared company data is unavailable.'}${requestId ? ` (request ${requestId})` : ''}`);
    }
    const values: Partial<Record<SharedDashboardKey, unknown | null>> = {};
    for (const key of keys) {
      const validate = validators[key];
      const snapshot = result.snapshots[key];
      if (!validate || !snapshot) throw new Error(`Shared data response did not include ${key}.`);
      revisions.set(key, typeof snapshot.revision === 'string' ? snapshot.revision : null);
      const cached = readVersioned(key, validate);
      if (snapshot.value === null || snapshot.value === undefined) {
        if (cached !== null) {
          preserveForRecovery(key, cached);
          if (Array.isArray(cached) ? cached.length > 0 : cached !== null) throw new Error('No shared snapshot exists yet. This browser’s saved records were preserved for recovery and were not uploaded.');
        }
        values[key] = null;
        continue;
      }
      if (!validate(snapshot.value)) {
        if (cached !== null) preserveForRecovery(key, cached);
        throw new Error(`Shared company data failed validation for ${key}.`);
      }
      if (cached !== null && JSON.stringify(cached) !== JSON.stringify(snapshot.value)) {
        const hasLocalData = Array.isArray(cached) ? cached.length > 0 : cached !== null;
        if (hasLocalData) preserveForRecovery(key, cached);
      }
      writeVersioned(key, snapshot.value);
      values[key] = snapshot.value;
    }
    return values;
  })();
  sharedReadQueue.set(cacheKey, request);
  return request.finally(() => { if (sharedReadQueue.get(cacheKey) === request) sharedReadQueue.delete(cacheKey); });
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
