import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { addExpenseLedgerRecord, deleteExpenseLedgerRecord, getCurrentUser, readExpenseLedger } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to view expenses.' }, { status: 401 });
  try { return NextResponse.json({ entries: await readExpenseLedger() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load expenses.' }, { status: 503 }); }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to record expenses.' }, { status: 401 });
  try {
    const body = await request.json() as { id?: unknown; amount?: unknown; category?: unknown; note?: unknown };
    const amount = Number(body.amount);
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!Number.isFinite(amount) || amount <= 0 || !category || note.length < 2 || note.length > 500) {
      return NextResponse.json({ error: 'Enter a valid amount, category, and note.' }, { status: 400 });
    }
    const id = typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 100 ? body.id : randomUUID();
    const record = { id, amount, category, note, date: new Date().toISOString(), createdBy: user.name };
    await addExpenseLedgerRecord(record);
    return NextResponse.json({ entry: record }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save expense.' }, { status: 503 }); }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to remove expenses.' }, { status: 401 });
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'Expense ID is required.' }, { status: 400 });
    await deleteExpenseLedgerRecord(body.id);
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to remove expense.' }, { status: 503 }); }
}
