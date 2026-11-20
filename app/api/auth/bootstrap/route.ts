import { NextResponse } from 'next/server';
import { createFirstSuperAdmin, signIn } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; name?: string; password?: string };
    const email = body.email?.trim() || '';
    const name = body.name?.trim() || '';
    const password = body.password || '';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
      return NextResponse.json({ error: 'Enter your name, a valid email, and a password with at least 10 characters.' }, { status: 400 });
    }
    const user = await createFirstSuperAdmin(email, name, password);
    await signIn(email, password);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete setup.';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
