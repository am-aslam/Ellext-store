import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import SuperAdminClient from './super-admin-client';

export const dynamic = 'force-dynamic';
export default async function SuperAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'super_admin') redirect('/');
  return <SuperAdminClient userName={user.name} />;
}
