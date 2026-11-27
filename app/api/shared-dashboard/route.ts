import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getCurrentUser, mutateSharedDashboardRow, readSharedDashboardOverview, readSharedDashboardValue, readSharedDashboardValues, SharedDashboardConflictError, writeSharedDashboardValue } from '@/lib/auth';
import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, storageKeys } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_SHARED_API_BODY_BYTES = 4 * 1024 * 1024;
const MAX_CURRENCY_ROW_IMAGE_BYTES = 3_000_000;

async function readBoundedBody(request: Request): Promise<{ body: string | null; bytes: number }> {
  if (!request.body) return { body: '', bytes: 0 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SHARED_API_BODY_BYTES) {
        await reader.cancel();
        return { body: null, bytes };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), bytes).toString('utf8');
  return { body, bytes };
}

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
  let operation: string | null = null;
  const respond = (body: Record<string, unknown>, responseStatus = 200) => {
    status = responseStatus;
    const log = { event: 'shared_dashboard_api', requestId, method: 'PUT', endpoint: '/api/shared-dashboard', durationMs: Math.round(performance.now() - startedAt), authDurationMs, parseDurationMs, writeDurationMs, payloadBytes, key: key || null, operation, expectedRevision, storageMode, role: userRole, status, failureCategory };
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
    const declaredBytes = Number(request.headers.get('content-length') || 0);
    if (declaredBytes > MAX_SHARED_API_BODY_BYTES) {
      payloadBytes = declaredBytes;
      parseDurationMs = Math.round(performance.now() - parseStartedAt);
      failureCategory = 'payload_too_large';
      return respond({ error: 'Shared-data request exceeds the 4 MiB application limit. Save one row at a time; no data was changed.' }, 413);
    }
    const bounded = await readBoundedBody(request);
    payloadBytes = bounded.bytes;
    if (bounded.body === null) {
      parseDurationMs = Math.round(performance.now() - parseStartedAt);
      failureCategory = 'payload_too_large';
      return respond({ error: 'Shared-data request exceeds the 4 MiB application limit. Save one row at a time; no data was changed.' }, 413);
    }
    const rawBody = bounded.body;
    let body: { key?: unknown; value?: unknown; revision?: unknown; operation?: unknown; row?: unknown; id?: unknown; baseRow?: unknown; baseImageDigest?: unknown };
    try { body = JSON.parse(rawBody) as typeof body; }
    catch { parseDurationMs = Math.round(performance.now() - parseStartedAt); failureCategory = 'invalid_json'; return respond({ error: 'Request body must be valid JSON.' }, 400); }
    parseDurationMs = Math.round(performance.now() - parseStartedAt);
    key = typeof body.key === 'string' ? body.key : '';
    operation = typeof body.operation === 'string' ? body.operation : 'replace-snapshot';
    const validator = validators[key];
    if (!validator) { failureCategory = 'invalid_key'; return respond({ error: 'Unknown shared data key.' }, 400); }
    if (body.revision !== undefined && body.revision !== null && (typeof body.revision !== 'string' || !Number.isFinite(Date.parse(body.revision)))) {
      failureCategory = 'invalid_revision'; return respond({ error: 'Shared data revision is invalid. Refresh the page and retry.' }, 400);
    }
    expectedRevision = typeof body.revision === 'string' ? body.revision : null;
    const writeStartedAt = performance.now();
    let saved: { storageMode: string; revision: string; merged?: boolean };
    try {
      if (body.operation === 'row-upsert' || body.operation === 'row-delete') {
        if (![storageKeys.currencyRows, storageKeys.productIncreases, storageKeys.sellingEntries].includes(key as typeof storageKeys.currencyRows)) {
          failureCategory = 'invalid_key'; return respond({ error: 'Row operations are not supported for this shared-data key.' }, 400);
        }
        const rowKey = key as typeof storageKeys.currencyRows | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries;
        const isDelete = body.operation === 'row-delete';
        const rowId = isDelete
          ? (typeof body.id === 'string' ? body.id : '')
          : body.row && typeof body.row === 'object' && !Array.isArray(body.row)
            ? String((body.row as Record<string, unknown>)[rowKey === storageKeys.currencyRows ? 'id' : 'sourceId'] ?? '')
            : '';
        const currencyImageOmitted = rowKey === storageKeys.currencyRows
          && body.row && typeof body.row === 'object' && !Array.isArray(body.row)
          && !Object.hasOwn(body.row, 'image');
        const submittedImage = rowKey === storageKeys.currencyRows && body.row && typeof body.row === 'object' && !Array.isArray(body.row)
          ? (body.row as Record<string, unknown>).image
          : null;
        if (typeof submittedImage === 'string' && Buffer.byteLength(submittedImage) > MAX_CURRENCY_ROW_IMAGE_BYTES) {
          failureCategory = 'currency_image_too_large';
          return respond({ error: 'Currency row images must be optimized to 3 MB or less before saving. No data was changed.' }, 413);
        }
        const rowForValidation = currencyImageOmitted
          ? [{ ...(body.row as Record<string, unknown>), image: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' }]
          : [body.row];
        if (!rowId || (!isDelete && (!validator(rowForValidation) || (currencyImageOmitted && (!body.baseRow || typeof body.baseImageDigest !== 'string'))))) { failureCategory = 'validation'; return respond({ error: 'The row did not pass validation.' }, 400); }
        if (body.baseRow !== null && (typeof body.baseRow !== 'object' || Array.isArray(body.baseRow))) { failureCategory = 'validation'; return respond({ error: 'The row baseline is invalid.' }, 400); }
        const baseImageDigest = body.baseImageDigest === undefined || body.baseImageDigest === null ? null : typeof body.baseImageDigest === 'string' && /^[a-f0-9]{64}$/i.test(body.baseImageDigest) ? body.baseImageDigest : undefined;
        if (body.baseImageDigest !== undefined && body.baseImageDigest !== null && !baseImageDigest) { failureCategory = 'validation'; return respond({ error: 'The image revision is invalid.' }, 400); }
        saved = await mutateSharedDashboardRow({ key: rowKey, operation: isDelete ? 'delete' : 'upsert', id: rowId, row: body.row as never, baseRow: body.baseRow ?? null, baseImageDigest, expectedRevision, requestId });
      } else {
        if (!validator(body.value)) { failureCategory = 'validation'; return respond({ error: 'Shared data did not pass validation.' }, 400); }
        saved = await writeSharedDashboardValue(key, body.value, expectedRevision, requestId);
      }
    } finally { writeDurationMs = Math.round(performance.now() - writeStartedAt); }
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
