import { NextResponse } from 'next/server';
import { clearSession, SESSION_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export async function POST() {
  clearSession(cookies().get(SESSION_COOKIE)?.value);
  return NextResponse.json({ success: true });
}
