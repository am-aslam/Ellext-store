import type { MemberInvite, ProductRequest } from './mock-data';

export const storageKeys = {
  cart: 'ellextstore:v1:cart',
  wishlist: 'ellextstore:v1:wishlist',
  productRequests: 'ellextstore:v1:product-requests',
  memberInvitations: 'ellextstore:v1:member-invitations',
  currencyRows: 'ellextstore:v1:currency-rows',
  currencyRate: 'ellextstore:v1:currency-rate',
  productIncreases: 'ellextstore:v1:product-increases',
  sellingEntries: 'ellextstore:v1:selling-entries',
  productCategories: 'ellextstore:v1:product-categories',
  companyExpenses: 'ellextstore:v1:company-expenses',
  expenseLedger: 'ellextstore:v1:expense-ledger',
} as const;

export const defaultProductCategories = ['Ring', 'Bangle', 'Chain', 'Ear ring'];
export type CompanyExpense = { id: string; amount: number; note: string; date: string };
export type ExpenseLedgerEntry = { id: string; amount: number; category: string; note: string; date: string; createdBy?: string; localOnly?: boolean };

export type CurrencyRow = {
  id: string;
  date: string;
  image: string;
  description: string;
  usd: number;
  productCount: number;
  active: boolean;
  category?: string;
};
export type CurrencyRateSnapshot = { usdToInr: number; updatedAt: string };
// `increaseInr` keeps the existing storage shape; it now stores the complete
// company selling price (including the INR buy value), not an amount added on top.
export type ProductIncrease = { sourceId: string; increaseInr: number; locked: boolean; updatedAt: string };
export type SellingEntry = {
  sourceId: string;
  soldCount: number;
  unitExpense?: number;
  unitExpenseNote?: string;
  retailerAmountInr?: number;
  retailerSoldCount?: number;
  retailerUpdatedAt?: string;
  updatedAt: string;
};

export type SharedRowSnapshotKey = typeof storageKeys.currencyRows | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries;
export type StoredRowValidationIssue = { field: string; rule: string };

/** Return only safe schema diagnostics; never include the rejected value. */
export function getStoredRowValidationIssue(key: SharedRowSnapshotKey, item: unknown): StoredRowValidationIssue | null {
  if (!isRecord(item)) return { field: '$', rule: 'expected_object' };
  const fail = (field: string, rule: string) => ({ field, rule });
  if (key === storageKeys.currencyRows) {
    if (typeof item.id !== 'string') return fail('id', 'string');
    if (typeof item.date !== 'string' || !Number.isFinite(Date.parse(item.date))) return fail('date', 'valid_timestamp_string');
    if (typeof item.image !== 'string' || item.image.length > 5_000_000) return fail('image', 'string_max_5000000');
    if (typeof item.description !== 'string' || item.description.trim().length < 2) return fail('description', 'string_min_2');
    if (!Number.isFinite(item.usd) || Number(item.usd) < 0) return fail('usd', 'finite_nonnegative_number');
    if (!Number.isInteger(item.productCount) || Number(item.productCount) < 0) return fail('productCount', 'nonnegative_integer');
    if (item.category !== undefined && typeof item.category !== 'string') return fail('category', 'optional_string');
    if (typeof item.active !== 'boolean') return fail('active', 'boolean');
    return null;
  }
  if (key === storageKeys.productIncreases) {
    if (typeof item.sourceId !== 'string') return fail('sourceId', 'string');
    if (!Number.isFinite(item.increaseInr) || Number(item.increaseInr) < 0) return fail('increaseInr', 'finite_nonnegative_number');
    if (typeof item.locked !== 'boolean') return fail('locked', 'boolean');
    if (!isTimestamp(item.updatedAt)) return fail('updatedAt', 'valid_timestamp');
    return null;
  }
  if (typeof item.sourceId !== 'string') return fail('sourceId', 'string');
  if (!Number.isInteger(item.soldCount) || Number(item.soldCount) < 0) return fail('soldCount', 'nonnegative_integer');
  if (item.unitExpense !== undefined && (!Number.isFinite(item.unitExpense) || Number(item.unitExpense) < 0)) return fail('unitExpense', 'optional_finite_nonnegative');
  if (item.unitExpenseNote !== undefined && (typeof item.unitExpenseNote !== 'string' || item.unitExpenseNote.length > 500)) return fail('unitExpenseNote', 'optional_string_max_500');
  if (item.retailerAmountInr !== undefined && (!Number.isFinite(item.retailerAmountInr) || Number(item.retailerAmountInr) <= 0)) return fail('retailerAmountInr', 'optional_finite_positive');
  if (item.retailerSoldCount !== undefined && (!Number.isInteger(item.retailerSoldCount) || Number(item.retailerSoldCount) < 0)) return fail('retailerSoldCount', 'optional_nonnegative_integer');
  if (item.retailerUpdatedAt !== undefined && !isTimestamp(item.retailerUpdatedAt)) return fail('retailerUpdatedAt', 'optional_valid_timestamp');
  if (!isTimestamp(item.updatedAt)) return fail('updatedAt', 'valid_timestamp');
  return null;
}

export function isStoredSellingEntries(value: unknown): value is SellingEntry[] {
  return Array.isArray(value) && value.every(item => getStoredRowValidationIssue(storageKeys.sellingEntries, item) === null);
}

export function isStoredExpenseLedger(value: unknown): value is ExpenseLedgerEntry[] {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && typeof item.id === 'string' && Number.isFinite(item.amount) && Number(item.amount) > 0
    && typeof item.category === 'string' && item.category.trim().length > 0
    && typeof item.note === 'string' && item.note.trim().length > 0 && isTimestamp(item.date)
    && (item.createdBy === undefined || typeof item.createdBy === 'string')
    && (item.localOnly === undefined || typeof item.localOnly === 'boolean'));
}

export function isStoredProductIncreases(value: unknown): value is ProductIncrease[] {
  return Array.isArray(value) && value.every(item => getStoredRowValidationIssue(storageKeys.productIncreases, item) === null);
}

export function isStoredCurrencyRows(value: unknown): value is CurrencyRow[] {
  return Array.isArray(value) && value.every(row => getStoredRowValidationIssue(storageKeys.currencyRows, row) === null);
}

export function isStoredCurrencyRate(value: unknown): value is CurrencyRateSnapshot {
  return isRecord(value) && Number.isFinite(value.usdToInr) && Number(value.usdToInr) > 0
    && isTimestamp(value.updatedAt);
}

export type StoredCartItem = { productId: string; quantity: number; selectedVariant?: string };
export type StoredCartSnapshot = { items: StoredCartItem[]; itemCount: number; subtotal: number };

type VersionedValue<T> = { version: 1; data: T };

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isStoredCart(value: unknown): value is StoredCartItem[] {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && typeof item.productId === 'string'
    && Number.isInteger(item.quantity) && Number(item.quantity) > 0 && Number(item.quantity) <= 99
    && (item.selectedVariant === undefined || typeof item.selectedVariant === 'string'));
}

export function isStoredCartSnapshot(value: unknown): value is StoredCartSnapshot {
  if (!isRecord(value) || !isStoredCart(value.items)) return false;
  return Number.isInteger(value.itemCount) && Number(value.itemCount) >= 0
    && Number.isFinite(value.subtotal) && Number(value.subtotal) >= 0
    && Number(value.itemCount) === value.items.reduce((count, item) => count + item.quantity, 0);
}

export function isStoredWishlist(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isStoredProductRequests(value: unknown): value is ProductRequest[] {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim().length >= 3
    && typeof item.category === 'string' && typeof item.notes === 'string' && isTimestamp(item.createdAt)
    && ['Submitted', 'Under review', 'Fulfilled'].includes(String(item.status)));
}

export function isStoredMemberInvitations(value: unknown): value is MemberInvite[] {
  return Array.isArray(value) && value.every(item => isRecord(item)
    && typeof item.name === 'string' && item.name.trim().length >= 2
    && typeof item.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)
    && isTimestamp(item.createdAt) && ['Pending', 'Accepted', 'Expired'].includes(String(item.status)));
}

export function readVersioned<T>(key: string, validate: (value: unknown) => value is T): T | null {
  const data = readVersionedRaw(key);
  return data !== null && validate(data) ? data : null;
}

/** Read only a known versioned envelope without validating or rewriting its payload. */
export function readVersionedRaw(key: string): unknown | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Preserve malformed data for manual recovery; never delete user storage
    // while attempting to read it.
    return null;
  }
  if (isRecord(parsed) && parsed.version === 1 && Object.hasOwn(parsed, 'data')) return parsed.data;
  // An unknown version or invalid value is left untouched for recovery.
  return null;
}

export function writeVersioned<T>(key: string, data: T): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    const value: VersionedValue<T> = { version: 1, data };
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
