import type { Metadata } from 'next';
import { GlobalDataLoading } from '@/components/global-data-loading';
import { SharedDataValidationBanner } from '@/components/shared-data-validation-banner';
import './globals.css';

export const metadata: Metadata = {
  title: 'EllextStore — Dashboard',
  description: 'Your fashion and sales dashboard.',
  icons: { icon: '/ellext-icon.png', apple: '/ellext-icon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<SharedDataValidationBanner /><GlobalDataLoading /></body></html>;
}
