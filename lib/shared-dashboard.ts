import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, readVersioned, storageKeys, writeVersioned, type CurrencyRow, type ProductIncrease, type SellingEntry } from './storage';
import { fetchWithDataLoading } from './data-fetch';

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

export type DashboardOverview = { rows: CurrencyRow[]; increases: ProductIncrease[]; sales: SellingEntry[] };

/** Load a compact dashboard-only projection. Full product images remain in the shared snapshot. */
export async function loadDashboardOverview(signal?: AbortSignal): Promise<DashboardOverview> {
  const response = await fetchWithDataLoading('/api/shared-dashboard?view=overview', { cache: 'no-store', signal });
  const result = await response.json().catch(() => ({})) as {
    snapshots?: Record<string, { value?: unknown; revision?: string | null }>;
    error?: string;
    requestId?: string;
  };
  if (!response.ok || !result.snapshots) {
    const requestId = response.headers.get('x-request-id') || result.requestId;
    throw new Error(`${result.error || 'Shared company data is unavailable.'}${requestId ? ` (request ${requestId})` : ''}`);
  }
  const compactRows = result.snapshots[storageKeys.currencyRows]?.value;
  // This read intentionally excludes image blobs; provide the typed field the
  // dashboard expects without changing the real snapshot or browser cache.
  const rowSnapshot = Array.isArray(compactRows)
    ? compactRows.map(row => typeof row === 'object' && row !== null && !Array.isArray(row) ? { ...row, image: '' } : row)
    : compactRows;
  const increaseSnapshot = result.snapshots[storageKeys.productIncreases]?.value;
  const salesSnapshot = result.snapshots[storageKeys.sellingEntries]?.value;
  if (!isStoredCurrencyRows(rowSnapshot) || !isStoredProductIncreases(increaseSnapshot) || !isStoredSellingEntries(salesSnapshot)) {
    throw new Error('Shared dashboard data failed validation.');
  }
  return { rows: rowSnapshot, increases: increaseSnapshot, sales: salesSnapshot };
}

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
    response = await fetchWithDataLoading(`/api/shared-dashboard?key=${encodeURIComponent(key)}`, { cache: 'no-store', signal });
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

async function refreshSharedValueAfterConflict(key: SharedDashboardKey): Promise<void> {
  switch (key) {
    case storageKeys.currencyRows: await fetchSharedDashboardValue(key, isStoredCurrencyRows); return;
    case storageKeys.currencyRate: await fetchSharedDashboardValue(key, isStoredCurrencyRate); return;
    case storageKeys.productIncreases: await fetchSharedDashboardValue(key, isStoredProductIncreases); return;
    case storageKeys.sellingEntries: await fetchSharedDashboardValue(key, isStoredSellingEntries); return;
    case storageKeys.productCategories:
      await fetchSharedDashboardValue(key, (value): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 80));
      return;
  }
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
      response = await fetchWithDataLoading(`/api/shared-dashboard?keys=${keys.map(encodeURIComponent).join(',')}&attempt=${retryCount}`, { cache: 'no-store', signal });
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
  // Bind the CAS revision when the edit is submitted. Reading it later inside
  // the queue would let a stale whole-snapshot payload inherit the preceding
  // save's new revision and overwrite that save without a conflict.
  const expectedRevision = revisions.get(key) ?? null;
  const next = previous.catch(() => {}).then(async () => {
    try {
      const response = await fetchWithDataLoading('/api/shared-dashboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value, revision: expectedRevision }),
      });
      const responseText = await response.text();
      let result: { error?: string; storageMode?: 'supabase' | 'sqlite'; revision?: string; requestId?: string } = {};
      try { result = JSON.parse(responseText) as typeof result; } catch { /* Surface the HTTP status below without echoing server HTML. */ }
      const requestId = response.headers.get('x-request-id') || result.requestId;
      if (!response.ok) {
        const details = result.error || `Shared-data API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;
        if (response.status === 409) {
          try { await refreshSharedValueAfterConflict(key); }
          catch { /* The submitted snapshot is still preserved below if refresh is unavailable. */ }
          throw new Error(`Revision conflict: ${details} The latest shared snapshot was refreshed when reachable, and this submitted version was preserved for recovery. Refresh this page before retrying.${requestId ? ` (request ${requestId})` : ''}`);
        }
        throw new Error(`${details}${requestId ? ` (request ${requestId})` : ''}`);
      }
      if (!result.revision || !result.storageMode) throw new Error(`Shared-data API returned an incomplete save confirmation${requestId ? ` (request ${requestId})` : ''}.`);
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
