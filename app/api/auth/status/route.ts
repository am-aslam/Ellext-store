import { NextResponse } from 'next/server';
import { getStorageMode, hasSuperAdmin, isSupabaseConfigured } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const mode = await getStorageMode();
  return NextResponse.json({ setupComplete: await hasSuperAdmin(), mode, supabaseConfigured: isSupabaseConfigured(), deployment: process.env.VERCEL ? 'vercel' : 'local' });
}
