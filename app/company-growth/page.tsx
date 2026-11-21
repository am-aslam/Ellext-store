import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import CompanyGrowthClient from './client';

export const dynamic = 'force-dynamic';

export default async function CompanyGrowthPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  if (user.role !== 'super_admin') redirect('/');
  return <CompanyGrowthClient userName={user.name} />;
}
