import { NextResponse } from 'next/server';
import { getCurrentUser, listAdmins } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  return NextResponse.json({ admins: listAdmins() });
}
