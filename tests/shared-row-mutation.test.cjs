const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : originalRequire(specifier);
  loaded._compile(output, filename);
  return loaded.exports;
}

const storage = loadTypeScript('lib/storage.ts');
const mutation = loadTypeScript('lib/shared-row-mutation.ts', { './storage': storage });
const diagnosticsStore = loadTypeScript('lib/shared-data-diagnostics.ts');
const sharedDashboard = loadTypeScript('lib/shared-dashboard.ts', {
  './storage': storage,
  './data-fetch': { fetchWithDataLoading: async () => { throw new Error('not used by pure validation tests'); } },
  './shared-data-diagnostics': diagnosticsStore,
});
const financials = loadTypeScript('lib/financial-calculations.ts', { './storage': storage });

class TestNextResponse extends Response {
  static json(value, init = {}) {
    return new TestNextResponse(JSON.stringify(value), {
      ...init,
      headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
    });
  }
}

let activeStore;
const auth = {
  getCurrentUser: async () => ({ id: 'test-admin', role: 'admin', name: 'Test Admin', email: 'test@example.invalid' }),
  mutateSharedDashboardRow: (input) => mutation.mutateSharedRowWithStore(input, activeStore),
  readSharedDashboardOverview: async () => ({}),
  readSharedDashboardValue: async () => ({}),
  readSharedDashboardValues: async () => ({}),
  SharedDashboardConflictError: mutation.SharedDashboardConflictError,
  writeSharedDashboardValue: async () => ({}),
};
const route = loadTypeScript('app/api/shared-dashboard/route.ts', {
  'next/server': { NextResponse: TestNextResponse },
  'node:crypto': crypto,
  '@/lib/auth': auth,
  '@/lib/shared-row-mutation': mutation,
  '@/lib/storage': storage,
});

const key = storage.storageKeys.currencyRows;
const image = 'data:image/png;base64,AA==';
const original = {
  id: 'currency-1', date: '2026-11-24T10:00:00.000Z', image,
  description: 'Original product', usd: 25, productCount: 4, active: true, category: 'Ring',
};

function makeStore(initialRows = [structuredClone(original)], options = {}) {
  let rows = structuredClone(initialRows);
  let revision = '2026-11-24T10:00:00.000Z';
  let writes = 0;
  let conflictOnce = false;
  return {
    async read() { return { value: structuredClone(rows), revision, storageMode: 'supabase' }; },
    async write(_key, nextRows, expectedRevision) {
      writes += 1;
      if (options.failBeforeWrite) throw new Error('simulated database unavailable');
      if (options.concurrentUnrelatedUpdate && !conflictOnce) {
        conflictOnce = true;
        rows = [...rows, { id: 'currency-concurrent', date: '2026-11-24T11:00:00.000Z', image: '', description: 'Concurrent row', usd: 8, productCount: 1, active: true }];
        revision = '2026-11-24T11:01:00.000Z';
        throw new mutation.SharedDashboardConflictError('revision conflict');
      }
      if (expectedRevision !== revision) throw new mutation.SharedDashboardConflictError('revision conflict');
      rows = structuredClone(nextRows);
      revision = new Date(Date.parse(revision) + 1000).toISOString();
      if (options.timeoutAfterWrite) {
        const error = new Error('simulated response timeout after commit');
        error.name = 'TimeoutError';
        throw error;
      }
      return { storageMode: 'supabase', revision };
    },
    rows: () => structuredClone(rows),
    revision: () => revision,
    writes: () => writes,
  };
}

function changedRow(overrides = {}) {
  return { ...structuredClone(original), description: 'Updated product', ...overrides };
}

function requestBody({ row = changedRow(), baseRow = original, revision = '2026-11-24T10:00:00.000Z', baseImageDigest, operation = 'row-upsert', id = 'currency-1' } = {}) {
  return {
    key,
    operation,
    id,
    ...(operation === 'row-upsert' ? { row } : {}),
    baseRow,
    ...(baseImageDigest === undefined ? {} : { baseImageDigest }),
    revision,
  };
}

async function put(body) {
  return route.PUT(new Request('http://localhost/api/shared-dashboard', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

async function runPut(body, store) {
  activeStore = store;
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = () => {};
  console.error = () => {};
  try {
    const response = await put(body);
    return { response, json: await response.json() };
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
}

test('1. updates a currency row in a valid snapshot', async () => {
  const store = makeStore();
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.equal(store.rows()[0].description, 'Updated product');
  assert.equal(store.writes(), 1);
});

test('2. updates a row while preserving an unrelated legacy null field exactly', async () => {
  const legacy = { id: 'legacy-null', date: '2024-01-01T00:00:00Z', image: '', description: 'Legacy row', usd: 2, productCount: 1, active: true, category: null };
  const store = makeStore([structuredClone(original), legacy]);
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.deepEqual(store.rows()[1], legacy);
  assert.equal(store.rows()[0].description, 'Updated product');
});

test('3. preserves an unrelated row missing an optional category field', async () => {
  const legacy = { id: 'legacy-optional', date: '2024-01-01T00:00:00Z', image: '', description: 'Legacy row', usd: 2, productCount: 1, active: true };
  const store = makeStore([structuredClone(original), legacy]);
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.deepEqual(store.rows()[1], legacy);
});

test('4. updates while preserving an unrelated numeric-string legacy value', async () => {
  const legacy = { id: 'legacy-number', date: '2024-01-01T00:00:00Z', image: '', description: 'Legacy row', usd: '2', productCount: 1, active: true };
  const store = makeStore([structuredClone(original), legacy]);
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.deepEqual(store.rows()[1], legacy);
});

test('5. updates while preserving an unrelated invalid legacy timestamp', async () => {
  const legacy = { id: 'legacy-date', date: 'not-a-date', image: '', description: 'Legacy row', usd: 2, productCount: 1, active: true };
  const store = makeStore([structuredClone(original), legacy]);
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.deepEqual(store.rows()[1], legacy);
});

test('6. rejects an invalid submitted target row with a field diagnostic and no write', async () => {
  const store = makeStore();
  const { response, json } = await runPut(requestBody({ row: changedRow({ usd: '25' }) }), store);
  assert.equal(response.status, 400);
  assert.deepEqual(json.validation, { stage: 'target_row_validation', field: 'usd', rule: 'finite_nonnegative_number' });
  assert.deepEqual(store.rows(), [original]);
  assert.equal(store.writes(), 0);
});

test('7. rejects a well-formed but incorrect image digest using the server-side image', async () => {
  const store = makeStore();
  const { response } = await runPut(requestBody({ row: changedRow({ image: undefined }), baseRow: (({ image: _image, ...rest }) => rest)(original), baseImageDigest: '0'.repeat(64) }), store);
  assert.equal(response.status, 409);
  assert.deepEqual(store.rows(), [original]);
  assert.equal(store.writes(), 0);
});

test('8. rejects a stale row baseline as a conflict and preserves current data', async () => {
  const current = { ...structuredClone(original), description: 'Changed elsewhere' };
  const store = makeStore([current]);
  const { response } = await runPut(requestBody({ row: changedRow(), baseRow: original }), store);
  assert.equal(response.status, 409);
  assert.deepEqual(store.rows(), [current]);
  assert.equal(store.writes(), 0);
});

test('rejects a duplicate identifier for the target row without writing', async () => {
  const duplicate = { ...structuredClone(original), description: 'Duplicate target' };
  const store = makeStore([structuredClone(original), duplicate]);
  const { response, json } = await runPut(requestBody(), store);
  assert.equal(response.status, 409);
  assert.deepEqual(json.validation, { stage: 'snapshot_integrity', field: 'id', rule: 'unique_target_id', recordIndex: 1 });
  assert.deepEqual(store.rows(), [original, duplicate]);
  assert.equal(store.writes(), 0);
});

test('replaces the image when the row includes a validated new image', async () => {
  const store = makeStore();
  const replacementImage = 'data:image/jpeg;base64,BBBB';
  const { response } = await runPut(requestBody({ row: changedRow({ image: replacementImage }) }), store);
  assert.equal(response.status, 200);
  assert.equal(store.rows()[0].image, replacementImage);
  assert.equal(store.rows()[0].description, 'Updated product');
});

test('9. retries a revision race and keeps a concurrent unrelated row update', async () => {
  const store = makeStore([structuredClone(original)], { concurrentUnrelatedUpdate: true });
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 200);
  assert.equal(store.rows().find(row => row.id === 'currency-1').description, 'Updated product');
  assert.equal(store.rows().find(row => row.id === 'currency-concurrent').description, 'Concurrent row');
  assert.equal(store.writes(), 2);
});

test('10. reports a pre-write database failure without changing stored rows', async () => {
  const store = makeStore([structuredClone(original)], { failBeforeWrite: true });
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 503);
  assert.deepEqual(store.rows(), [original]);
  assert.equal(store.writes(), 1);
});

test('11. leaves an ambiguous timeout for read-only reconciliation without retrying', async () => {
  const store = makeStore([structuredClone(original)], { timeoutAfterWrite: true });
  const { response } = await runPut(requestBody(), store);
  assert.equal(response.status, 503);
  assert.equal(store.writes(), 1);
  assert.equal(store.rows()[0].description, 'Updated product');
  const serialized = JSON.stringify(store.rows());
  const confirmed = await mutation.reconcileAmbiguousSnapshotWrite({
    serializedPayload: serialized,
    expectedRevision: '2026-11-24T10:00:00.000Z',
    readCurrent: async () => ({ payload: store.rows(), revision: store.revision() }),
  });
  assert.deepEqual(confirmed, { revision: store.revision() });
  assert.equal(store.writes(), 1);
});

test('12. failed validation never overwrites existing data', async () => {
  const store = makeStore();
  const before = store.rows();
  const { response, json } = await runPut(requestBody({ row: changedRow({ description: '' }) }), store);
  assert.equal(response.status, 400);
  assert.equal(json.validation.field, 'description');
  assert.deepEqual(store.rows(), before);
  assert.equal(store.writes(), 0);
});

test('invalid legacy target is locked against accidental edit or overwrite', async () => {
  const legacyTarget = { ...structuredClone(original), usd: '25' };
  const store = makeStore([legacyTarget]);
  const { response, json } = await runPut(requestBody({ row: changedRow(), baseRow: legacyTarget }), store);
  assert.equal(response.status, 409);
  assert.equal(json.validation.field, 'usd');
  assert.deepEqual(store.rows(), [legacyTarget]);
  assert.equal(store.writes(), 0);
});

test('record-level reads retain all valid rows in an otherwise valid snapshot', () => {
  const snapshot = [structuredClone(original), { ...structuredClone(original), id: 'currency-2', description: 'Second product' }];
  const result = sharedDashboard.sanitizeSharedRowArray(key, snapshot);
  assert.deepEqual(result.value, snapshot);
  assert.deepEqual(result.issues, []);
});

test('record-level reads exclude one null-field legacy row and retain valid rows', () => {
  const legacy = { ...structuredClone(original), id: 'legacy-null', category: null };
  const result = sharedDashboard.sanitizeSharedRowArray(key, [structuredClone(original), legacy]);
  assert.deepEqual(result.value, [original]);
  assert.deepEqual(result.issues.map(({ recordIndex, field, status }) => ({ recordIndex, field, status })), [{ recordIndex: 1, field: 'category', status: 'excluded_from_view_and_calculations' }]);
});

test('a missing optional field remains valid and unchanged', () => {
  const legacy = { id: 'legacy-optional', date: original.date, image, description: 'No category', usd: 4, productCount: 1, active: true };
  const result = sharedDashboard.sanitizeSharedRowArray(key, [legacy]);
  assert.deepEqual(result.value, [legacy]);
  assert.deepEqual(result.issues, []);
});

test('numeric-string and invalid-timestamp records are individually excluded', () => {
  const numericString = { ...structuredClone(original), id: 'legacy-number', usd: '25' };
  const invalidTime = { ...structuredClone(original), id: 'legacy-time', date: 'not-a-date' };
  const result = sharedDashboard.sanitizeSharedRowArray(key, [structuredClone(original), numericString, invalidTime]);
  assert.deepEqual(result.value, [original]);
  assert.deepEqual(result.issues.map(issue => [issue.recordIndex, issue.field]), [[1, 'usd'], [2, 'date']]);
});

test('ineligible financial records are omitted and carry an explicit calculation status', () => {
  const products = [structuredClone(original)];
  const validPrice = { sourceId: original.id, increaseInr: 40, locked: true, updatedAt: original.date };
  const validSale = { sourceId: original.id, soldCount: 2, updatedAt: original.date };
  const unrelatedSale = { sourceId: 'missing-product', soldCount: 1, updatedAt: original.date };
  const reconciled = sharedDashboard.reconcileSharedReferences(products, [validPrice], [validSale, unrelatedSale], true);
  assert.deepEqual(reconciled.sales, [validSale]);
  assert.equal(reconciled.diagnostics[0].rule, 'currency_row_reference_missing');
  assert.equal(reconciled.diagnostics[0].status, 'excluded_from_financial_calculations');
});

test('two dashboard roles receive the same safe valid-row projection', () => {
  const legacy = { ...structuredClone(original), id: 'legacy-number', usd: '25' };
  const snapshot = [structuredClone(original), legacy];
  const adminView = sharedDashboard.sanitizeSharedRowArray(key, snapshot);
  const superAdminView = sharedDashboard.sanitizeSharedRowArray(key, snapshot);
  assert.deepEqual(adminView.value, superAdminView.value);
  assert.deepEqual(adminView.issues, superAdminView.issues);
  assert.deepEqual(snapshot[1], legacy);
});

test('financial totals use trusted values and become unavailable when excluded records make the result partial', () => {
  const product = structuredClone(original);
  const price = { sourceId: product.id, increaseInr: 40, locked: true, updatedAt: product.date };
  const sale = { sourceId: product.id, soldCount: 2, retailerSoldCount: 0, updatedAt: product.date };
  const rate = { usdToInr: 80, updatedAt: product.date };
  const complete = financials.calculateCompanyGrowth({
    rows: [product], increases: [price], sales: [sale], rate,
    operatingExpenses: 5, ledgerExpenses: 5, hasExcludedRecords: false,
  });
  assert.equal(complete.revenue, 80);
  assert.equal(complete.cogs, 4000);
  assert.equal(complete.grossProfit, -3920);
  const partial = financials.calculateCompanyGrowth({
    rows: [product], increases: [price], sales: [sale], rate,
    operatingExpenses: 5, ledgerExpenses: 5, hasExcludedRecords: true,
  });
  assert.equal(partial.revenue, null);
  assert.equal(partial.cogs, null);
  assert.equal(partial.grossProfit, null);
  assert.equal(partial.netProfit, null);
});

test('dashboard collected amount is unavailable when a sold item lacks a trusted selling price', () => {
  const summary = financials.calculateDashboardSales([structuredClone(original)], [], [{ sourceId: original.id, soldCount: 1, updatedAt: original.date }]);
  assert.equal(summary.sold, 1);
  assert.equal(summary.collected, null);
});

test('dashboard includes retailer collections and quantities without double counting stock', () => {
  const product = structuredClone(original);
  product.productCount = 5;
  const summary = financials.calculateDashboardSales(
    [product],
    [{ sourceId: product.id, increaseInr: 100, locked: true, updatedAt: product.date }],
    [{ sourceId: product.id, soldCount: 1, retailerSoldCount: 2, retailerAmountInr: 80, updatedAt: product.date }],
  );
  assert.equal(summary.sold, 3);
  assert.equal(summary.available, 2);
  assert.equal(summary.collected, 260);
});

test('retained currency image uses a digest of the server-side image', () => {
  const digest = crypto.createHash('sha256').update(image).digest('hex');
  const plan = mutation.prepareSharedRowMutation({
    key, operation: 'upsert', id: original.id,
    row: { id: original.id, date: original.date, description: 'Retained image update', usd: original.usd, productCount: original.productCount, active: original.active, category: original.category },
    baseRow: (({ image: _image, ...rest }) => rest)(original), baseImageDigest: digest,
    records: [structuredClone(original)],
  });
  assert.equal(plan.rows[0].image, image);
  assert.equal(plan.rows[0].description, 'Retained image update');
});

test('malformed snapshot container is rejected before any write', async () => {
  let writes = 0;
  const store = {
    read: async () => ({ value: null, revision: '2026-11-24T10:00:00.000Z', storageMode: 'supabase' }),
    write: async () => { writes += 1; throw new Error('must not write'); },
  };
  const { response, json } = await runPut(requestBody(), store);
  assert.equal(response.status, 422);
  assert.deepEqual(json.validation, { stage: 'snapshot_structure', field: '$', rule: 'null_payload_with_revision', recordIndex: null });
  assert.equal(writes, 0);
});

test('malformed digest syntax is rejected before reading or writing the snapshot', async () => {
  const store = makeStore();
  const { response, json } = await runPut(requestBody({ baseImageDigest: 'not-a-sha256' }), store);
  assert.equal(response.status, 400);
  assert.equal(json.validation.field, 'baseImageDigest');
  assert.deepEqual(store.rows(), [original]);
  assert.equal(store.writes(), 0);
});
