import { NextResponse } from 'next/server';
import { getStorageMode, getSupabaseDiagnostics, hasSuperAdmin, isSupabaseConfigured } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [authMode, diagnostics, setupResult] = await Promise.all([
    getStorageMode(), getSupabaseDiagnostics(), hasSuperAdmin().then(value => ({ value })).catch(() => ({ value: null })),
  ]);
  const mode = diagnostics.restApi === 'connected' ? 'supabase' : authMode;
  const sharedDataReady = diagnostics.sharedTable === 'available' && diagnostics.permissions === 'valid';
  return NextResponse.json({
    setupComplete: setupResult.value, mode, supabaseConfigured: isSupabaseConfigured(),
    deployment: process.env.VERCEL ? 'vercel' : 'local', sharedDataReady,
    sharedDataError: diagnostics.error, diagnostics,
  });
}
