import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ProductPercentageClient from './client';

export const dynamic = 'force-dynamic';
export default async function ProductPercentagePage() {
  if (!await getCurrentUser()) redirect('/sign-in');
  return <ProductPercentageClient />;
}
