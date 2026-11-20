import { NextResponse } from 'next/server';
import { signIn } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    if (!body.email || !body.password) return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    const result = await signIn(body.email, body.password);
    return NextResponse.json({ user: result.user, mode: result.mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sign in.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
