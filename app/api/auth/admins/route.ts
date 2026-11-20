import { NextResponse } from 'next/server';
import { createAdmin, generateTemporaryPassword, getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== 'super_admin') return NextResponse.json({ error: 'Only the Super Admin can create Admin accounts.' }, { status: 403 });
  try {
    const body = await request.json() as { email?: string; name?: string };
    const email = body.email?.trim() || '';
    const name = body.name?.trim() || '';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter the Admin name and a valid email.' }, { status: 400 });
    }
    const password = generateTemporaryPassword();
    const user = await createAdmin(email, name, password);
    return NextResponse.json({ user, password }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create this Admin account.';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
