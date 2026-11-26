import type { Metadata } from 'next';
import { GlobalDataLoading } from '@/components/global-data-loading';
import './globals.css';

export const metadata: Metadata = {
  title: 'EllextStore — Dashboard',
  description: 'Your fashion and sales dashboard.',
  icons: { icon: '/ellext-icon.png', apple: '/ellext-icon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<GlobalDataLoading /></body></html>;
}
