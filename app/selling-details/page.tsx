import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import SellingDetailsClient from './client';

export const dynamic = 'force-dynamic';
export default async function SellingDetailsPage() {
  if (!await getCurrentUser()) redirect('/sign-in');
  return <SellingDetailsClient />;
}
