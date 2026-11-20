import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import CurrencyExchangeClient from './client';

export const dynamic = 'force-dynamic';
export default async function CurrencyExchangePage() {
  if (!await getCurrentUser()) redirect('/sign-in');
  return <CurrencyExchangeClient />;
}
