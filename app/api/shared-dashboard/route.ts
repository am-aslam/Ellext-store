import { NextResponse } from 'next/server';
import { getCurrentUser, readSharedDashboardValue, SharedDashboardConflictError, writeSharedDashboardValue } from '@/lib/auth';
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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to view shared company data.' }, { status: 401 });
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!validators[key]) return NextResponse.json({ error: 'Unknown shared data key.' }, { status: 400 });
  try { return NextResponse.json(await readSharedDashboardValue(key)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load shared company data.' }, { status: 503 }); }
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
