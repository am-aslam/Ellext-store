import { NextResponse } from 'next/server';
import { checkSharedDashboardTable, getStorageMode, hasSuperAdmin, isSupabaseConfigured } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [mode, sharedData] = await Promise.all([getStorageMode(), checkSharedDashboardTable()]);
  return NextResponse.json({ setupComplete: await hasSuperAdmin(), mode, supabaseConfigured: isSupabaseConfigured(), deployment: process.env.VERCEL ? 'vercel' : 'local', sharedDataReady: sharedData.ready, sharedDataError: sharedData.error });
}
