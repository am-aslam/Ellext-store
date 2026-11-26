import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getCurrentUser, readSharedDashboardOverview, readSharedDashboardValue, readSharedDashboardValues, SharedDashboardConflictError, writeSharedDashboardValue } from '@/lib/auth';
import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, storageKeys } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validators: Record<string, (value: unknown) => boolean> = {
  [storageKeys.currencyRows]: isStoredCurrencyRows,
  [storageKeys.currencyRate]: isStoredCurrencyRate,
  [storageKeys.productIncreases]: isStoredProductIncreases,
  [storageKeys.sellingEntries]: isStoredSellingEntries,
  [storageKeys.productCategories]: (value): boolean => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 80),
};

export async function GET(request: Request) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  let authDurationMs = 0;
  let keys: string[] = [];
  let retryCount = 0;
  let status = 200;
  let serializationDurationMs = 0;
  let responseBytes = 0;
  let failureCategory: string | undefined;
  const log = () => console.info(JSON.stringify({ event: 'shared_dashboard_api', requestId, method: 'GET', endpoint: '/api/shared-dashboard', durationMs: Math.round(performance.now() - startedAt), authDurationMs, serializationDurationMs, responseBytes, status, keyCount: keys.length, retryCount, failureCategory: failureCategory ?? null }));
  const respond = (body: unknown) => {
    const serializationStartedAt = performance.now();
    const serialized = JSON.stringify(body);
    serializationDurationMs = Math.round(performance.now() - serializationStartedAt);
    responseBytes = Buffer.byteLength(serialized);
    log();
    return new NextResponse(serialized, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': requestId } });
  };
  const user = await getCurrentUser();
  authDurationMs = Math.round(performance.now() - startedAt);
  if (!user) { status = 401; failureCategory = 'unauthorized'; log(); return NextResponse.json({ error: 'Sign in to view shared company data.' }, { status }); }
  const params = new URL(request.url).searchParams;
  retryCount = Math.max(0, Math.min(10, Number(params.get('attempt')) || 0));
  if (params.get('view') === 'overview') {
    keys = [storageKeys.currencyRows, storageKeys.productIncreases, storageKeys.sellingEntries];
    try {
      const snapshots = await readSharedDashboardOverview(requestId);
      return respond({ snapshots });
    } catch (error) {
      status = error instanceof Error && error.name === 'TimeoutError' ? 504 : 503;
      failureCategory = status === 504 ? 'timeout' : 'storage_unavailable';
      log();
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load shared company data.', requestId }, { status, headers: { 'x-request-id': requestId } });
    }
  }
  keys = params.get('keys')?.split(',').filter(Boolean) ?? [params.get('key') || ''];
  keys = Array.from(new Set(keys));
  if (!keys.length || keys.some(key => !validators[key])) { status = 400; failureCategory = 'invalid_key'; log(); return NextResponse.json({ error: 'Unknown shared data key.' }, { status }); }
  try {
    if (keys.length === 1 && !params.has('keys')) {
      const snapshot = await readSharedDashboardValue(keys[0], requestId);
      return respond(snapshot);
    }
    const snapshots = await readSharedDashboardValues(keys, requestId);
    return respond({ snapshots });
  } catch (error) {
    status = error instanceof Error && error.name === 'TimeoutError' ? 504 : 503;
    failureCategory = status === 504 ? 'timeout' : 'storage_unavailable';
    log();
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load shared company data.', requestId }, { status, headers: { 'x-request-id': requestId } });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to update shared company data.' }, { status: 401 });
  try {
    const body = await request.json() as { key?: unknown; value?: unknown; revision?: unknown };
    const key = typeof body.key === 'string' ? body.key : '';
    const validator = validators[key];
    if (!validator) return NextResponse.json({ error: 'Unknown shared data key.' }, { status: 400 });
    if (!validator(body.value)) return NextResponse.json({ error: 'Shared data did not pass validation.' }, { status: 400 });
    if (body.revision !== undefined && body.revision !== null && (typeof body.revision !== 'string' || !Number.isFinite(Date.parse(body.revision)))) {
      return NextResponse.json({ error: 'Shared data revision is invalid. Refresh the page and retry.' }, { status: 400 });
    }
    const expectedRevision = typeof body.revision === 'string' ? body.revision : null;
    const saved = await writeSharedDashboardValue(key, body.value, expectedRevision);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    const conflict = error instanceof SharedDashboardConflictError;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save shared company data.' }, { status: conflict ? 409 : 503 });
  }
}
