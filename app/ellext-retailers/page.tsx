import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import EllextRetailersClient from './client';

export const dynamic = 'force-dynamic';

export default async function EllextRetailersPage() {
  if (!await getCurrentUser()) redirect('/sign-in');
  return <EllextRetailersClient />;
}
