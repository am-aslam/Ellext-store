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
  const requestId = randomUUID();
  const startedAt = performance.now();
  let authDurationMs = 0;
  let parseDurationMs = 0;
  let writeDurationMs = 0;
  let payloadBytes = 0;
  let key = '';
  let status = 200;
  let failureCategory: string | null = null;
  let expectedRevision: string | null = null;
  let storageMode: string | null = null;
  let userRole: string | null = null;
  const respond = (body: Record<string, unknown>, responseStatus = 200) => {
    status = responseStatus;
    const log = { event: 'shared_dashboard_api', requestId, method: 'PUT', endpoint: '/api/shared-dashboard', durationMs: Math.round(performance.now() - startedAt), authDurationMs, parseDurationMs, writeDurationMs, payloadBytes, key: key || null, expectedRevision, storageMode, role: userRole, status, failureCategory };
    (status >= 500 ? console.error : console.info)(JSON.stringify(log));
    return NextResponse.json({ ...body, requestId }, { status, headers: { 'x-request-id': requestId } });
  };
  const authStartedAt = performance.now();
  const user = await getCurrentUser();
  authDurationMs = Math.round(performance.now() - authStartedAt);
  if (!user) { failureCategory = 'unauthorized'; return respond({ error: 'Sign in to update shared company data.' }, 401); }
  userRole = user.role;
  try {
    const parseStartedAt = performance.now();
    const rawBody = await request.text();
    payloadBytes = Buffer.byteLength(rawBody);
    let body: { key?: unknown; value?: unknown; revision?: unknown };
    try { body = JSON.parse(rawBody) as typeof body; }
    catch { parseDurationMs = Math.round(performance.now() - parseStartedAt); failureCategory = 'invalid_json'; return respond({ error: 'Request body must be valid JSON.' }, 400); }
    parseDurationMs = Math.round(performance.now() - parseStartedAt);
    key = typeof body.key === 'string' ? body.key : '';
    const validator = validators[key];
    if (!validator) { failureCategory = 'invalid_key'; return respond({ error: 'Unknown shared data key.' }, 400); }
    if (!validator(body.value)) { failureCategory = 'validation'; return respond({ error: 'Shared data did not pass validation.' }, 400); }
    if (body.revision !== undefined && body.revision !== null && (typeof body.revision !== 'string' || !Number.isFinite(Date.parse(body.revision)))) {
      failureCategory = 'invalid_revision'; return respond({ error: 'Shared data revision is invalid. Refresh the page and retry.' }, 400);
    }
    expectedRevision = typeof body.revision === 'string' ? body.revision : null;
    const writeStartedAt = performance.now();
    let saved: Awaited<ReturnType<typeof writeSharedDashboardValue>>;
    try { saved = await writeSharedDashboardValue(key, body.value, expectedRevision, requestId); }
    finally { writeDurationMs = Math.round(performance.now() - writeStartedAt); }
    storageMode = saved.storageMode;
    return respond({ success: true, ...saved });
  } catch (error) {
    const conflict = error instanceof SharedDashboardConflictError;
    failureCategory = conflict ? 'revision_conflict' : 'database_or_network';
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    if (code === '42501') failureCategory = 'permission_denied';
    return respond({ error: error instanceof Error ? error.message : 'Unable to save shared company data.' }, conflict ? 409 : 503);
  }
}
