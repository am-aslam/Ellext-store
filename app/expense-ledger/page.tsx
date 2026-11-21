import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ExpenseLedgerClient from './client';

export const dynamic = 'force-dynamic';

export default async function ExpenseLedgerPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=%2Fexpense-ledger');
  return <ExpenseLedgerClient userName={user.name} />;
}
