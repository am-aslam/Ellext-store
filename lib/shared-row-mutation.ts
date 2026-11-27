import { createHash } from 'node:crypto';
import { getStoredRowValidationIssue, storageKeys, type CurrencyRow, type ProductIncrease, type SellingEntry, type SharedRowSnapshotKey } from './storage';

export type SharedRow = CurrencyRow | ProductIncrease | SellingEntry;
export type SharedRowOperation = 'upsert' | 'delete';
export type SharedStorageMode = 'supabase' | 'sqlite';
export type SharedSnapshot = { value: unknown | null; revision: string | null; storageMode: SharedStorageMode };

export class SharedDashboardConflictError extends Error {
  readonly stage = 'revision_conflict';
}

export class SharedRowMutationError extends Error {
  constructor(
    message: string,
    readonly stage: 'request_validation' | 'snapshot_structure' | 'target_row_validation' | 'snapshot_integrity',
    readonly status: 400 | 409 | 422,
    readonly field?: string,
    readonly recordIndex?: number,
    readonly rule?: string,
  ) {
    super(message);
    this.name = 'SharedRowMutationError';
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export function sharedRowIdentity(key: SharedRowSnapshotKey, value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const identity = key === storageKeys.currencyRows ? record.id : record.sourceId;
  return typeof identity === 'string' ? identity : null;
}

function validationError(key: SharedRowSnapshotKey, row: unknown, index?: number): SharedRowMutationError | null {
  const issue = getStoredRowValidationIssue(key, row);
  return issue ? new SharedRowMutationError(
    'The submitted row does not match the required data format.',
    'target_row_validation', 400, issue.field, index, issue.rule,
  ) : null;
}

export type SharedRowMutationPlan = {
  rows: unknown[];
  idempotent: boolean;
  preservedLegacyRecordCount: number;
};

/**
 * Validate the submitted target row and its baseline, while preserving every
 * unrelated snapshot entry verbatim, including legacy rows that fail today's
 * row schema. The snapshot container and target-ID integrity remain enforced.
 */
export function prepareSharedRowMutation(input: {
  key: SharedRowSnapshotKey;
  operation: SharedRowOperation;
  id: string;
  row?: unknown;
  baseRow: unknown | null;
  baseImageDigest?: string | null;
  records: unknown;
}): SharedRowMutationPlan {
  const { key, operation, id, row, baseRow } = input;
  if (typeof id !== 'string' || !id.trim()) {
    throw new SharedRowMutationError('A row identifier is required.', 'request_validation', 400, 'id', undefined, 'nonempty_string');
  }
  if (key === storageKeys.currencyRows && input.baseImageDigest != null && !/^[a-f0-9]{64}$/i.test(input.baseImageDigest)) {
    throw new SharedRowMutationError('The retained image revision is invalid.', 'request_validation', 400, 'baseImageDigest', undefined, 'sha256_hex');
  }
  if (operation === 'upsert' && (!row || sharedRowIdentity(key, row) !== id)) {
    throw new SharedRowMutationError('The submitted row identifier does not match the request.', 'request_validation', 400, key === storageKeys.currencyRows ? 'id' : 'sourceId', undefined, 'matches_request_id');
  }
  if (!Array.isArray(input.records)) {
    throw new SharedRowMutationError('The shared snapshot container is invalid. No rows were changed.', 'snapshot_structure', 422, '$', undefined, 'expected_array');
  }

  const currentRows = input.records as unknown[];
  const matches = currentRows
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => sharedRowIdentity(key, record) === id);
  if (matches.length > 1) {
    throw new SharedRowMutationError('The target row identifier appears more than once. No rows were changed.', 'snapshot_integrity', 409, key === storageKeys.currencyRows ? 'id' : 'sourceId', matches[1].index, 'unique_target_id');
  }
  const match = matches[0];
  const existing = match?.record;
  let candidateRow: unknown = row;

  if (existing !== undefined) {
    const existingIssue = getStoredRowValidationIssue(key, existing);
    if (existingIssue) {
      throw new SharedRowMutationError('This legacy row failed validation and is locked from edits to protect its original data.', 'snapshot_integrity', 409, existingIssue.field, match?.index, existingIssue.rule);
    }
  }

  if (operation === 'upsert') {
    if (key === storageKeys.currencyRows && row && typeof row === 'object' && !Array.isArray(row) && !Object.hasOwn(row, 'image')) {
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        throw new SharedRowMutationError('The retained product image is unavailable. Refresh before saving.', 'target_row_validation', 400, 'image', match?.index, 'existing_image_required');
      }
      candidateRow = { ...(existing as Record<string, unknown>), ...(row as Record<string, unknown>), image: (existing as CurrencyRow).image };
    }
    const issue = validationError(key, candidateRow, match?.index);
    if (issue) throw issue;
  }

  if (operation === 'upsert' && existing && canonicalJson(existing) === canonicalJson(candidateRow)) {
    return {
      rows: currentRows,
      idempotent: true,
      preservedLegacyRecordCount: currentRows.filter((record, index) => index !== match.index && getStoredRowValidationIssue(key, record) !== null).length,
    };
  }
  if (operation === 'delete' && !existing) {
    return {
      rows: currentRows,
      idempotent: true,
      preservedLegacyRecordCount: currentRows.filter(record => getStoredRowValidationIssue(key, record) !== null).length,
    };
  }

  let baseMatches = baseRow === null ? !existing : Boolean(existing && canonicalJson(existing) === canonicalJson(baseRow));
  if (key === storageKeys.currencyRows && existing && baseRow && input.baseImageDigest) {
    const currentRecord = existing as CurrencyRow;
    const { image: _image, ...currentWithoutImage } = currentRecord;
    baseMatches = canonicalJson(currentWithoutImage) === canonicalJson(baseRow)
      && typeof currentRecord.image === 'string'
      && createHash('sha256').update(currentRecord.image).digest('hex') === input.baseImageDigest;
  }
  if (!baseMatches) throw new SharedDashboardConflictError('This product row changed in another session. The newer shared row was kept; refresh before retrying your saved draft.');

  const nextRows = operation === 'delete'
    ? currentRows.filter((_record, index) => index !== match.index)
    : existing
      ? currentRows.map((record, index) => index === match.index ? candidateRow : record)
      : [...currentRows, candidateRow];

  // Validate only the newly written target; leave unrelated legacy records
  // untouched rather than normalizing or dropping them.
  if (operation === 'upsert') {
    const targetIndex = nextRows.findIndex(record => sharedRowIdentity(key, record) === id);
    if (targetIndex < 0 || nextRows.filter(record => sharedRowIdentity(key, record) === id).length !== 1) {
      throw new SharedRowMutationError('The updated target row failed snapshot integrity checks. No rows were changed.', 'snapshot_integrity', 409, key === storageKeys.currencyRows ? 'id' : 'sourceId', targetIndex < 0 ? undefined : targetIndex, 'unique_target_id');
    }
    const issue = validationError(key, nextRows[targetIndex], targetIndex);
    if (issue) throw issue;
  }
  const preservedLegacyRecordCount = nextRows.filter(record => sharedRowIdentity(key, record) !== id && getStoredRowValidationIssue(key, record) !== null).length;
  return { rows: nextRows, idempotent: false, preservedLegacyRecordCount };
}

export async function mutateSharedRowWithStore(input: {
  key: SharedRowSnapshotKey;
  operation: SharedRowOperation;
  id: string;
  row?: unknown;
  baseRow: unknown | null;
  baseImageDigest?: string | null;
  expectedRevision: string | null;
  requestId?: string;
}, store: {
  read: (key: SharedRowSnapshotKey, requestId?: string) => Promise<SharedSnapshot>;
  write: (key: SharedRowSnapshotKey, rows: unknown[], expectedRevision: string | null, requestId?: string) => Promise<{ storageMode: SharedStorageMode; revision: string }>;
}): Promise<{ storageMode: SharedStorageMode; revision: string; merged: boolean; attempts: number; preservedLegacyRecordCount: number; snapshotBytes: number; recordCount: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await store.read(input.key, input.requestId);
    if (current.value == null && current.revision !== null) {
      throw new SharedRowMutationError('The shared snapshot payload is invalid. No rows were changed.', 'snapshot_structure', 422, '$', undefined, 'null_payload_with_revision');
    }
    const records = current.value ?? [];
    const plan = prepareSharedRowMutation({ ...input, records });
    if (plan.idempotent) {
      if (!current.revision) throw new SharedRowMutationError('The saved row has no valid shared revision. Refresh before retrying.', 'snapshot_structure', 422, 'revision', undefined, 'revision_required');
      return { storageMode: current.storageMode, revision: current.revision, merged: current.revision !== input.expectedRevision, attempts: attempt + 1, preservedLegacyRecordCount: plan.preservedLegacyRecordCount, snapshotBytes: Buffer.byteLength(JSON.stringify(plan.rows)), recordCount: plan.rows.length };
    }
    try {
      const saved = await store.write(input.key, plan.rows, current.revision, input.requestId);
      return { ...saved, merged: current.revision !== input.expectedRevision, attempts: attempt + 1, preservedLegacyRecordCount: plan.preservedLegacyRecordCount, snapshotBytes: Buffer.byteLength(JSON.stringify(plan.rows)), recordCount: plan.rows.length };
    } catch (error) {
      if (!(error instanceof SharedDashboardConflictError) || attempt === 2) throw error;
    }
  }
  throw new SharedDashboardConflictError('Shared data changed repeatedly while saving. Your draft is preserved; refresh before retrying.');
}

/** Read-after-timeout check used by the Supabase write path. */
export async function reconcileAmbiguousSnapshotWrite(input: {
  serializedPayload: string;
  expectedRevision: string | null;
  readCurrent: () => Promise<{ payload: unknown; revision: string } | null>;
}): Promise<{ revision: string } | null> {
  const current = await input.readCurrent();
  if (!current) return null;
  if (JSON.stringify(current.payload) === input.serializedPayload) return { revision: current.revision };
  if (input.expectedRevision !== null && current.revision !== input.expectedRevision) {
    throw new SharedDashboardConflictError('Shared data changed while the save response was interrupted. The current server version was kept; refresh before retrying.');
  }
  return null;
}
