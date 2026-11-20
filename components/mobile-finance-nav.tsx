'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, LayoutDashboard, Menu, Percent, X } from 'lucide-react';

type FinanceRoute = '/' | '/currency-exchange' | '/product-percentage' | '/selling-details';

const routes: { href: FinanceRoute; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/currency-exchange', label: 'Currency Exchange', icon: ArrowLeftRight },
  { href: '/product-percentage', label: 'Product Percentage', icon: Percent },
  { href: '/selling-details', label: 'Selling Details', icon: ChartNoAxesColumnIncreasing },
];

export function MobileFinanceNav({ active }: { active: FinanceRoute }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return <>
    <button className="finance-mobile-menu" type="button" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}>
      <Menu size={21} />
    </button>
    {open && <>
      <button className="finance-mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
      <aside className="finance-mobile-drawer" role="dialog" aria-modal="true" aria-label="Main navigation">
        <div className="finance-mobile-drawer-head">
          <Link href="/" className="brand currency-brand" onClick={() => setOpen(false)}>Ellext<span>Store</span><i /></Link>
          <button className="finance-mobile-close" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={19} /></button>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          {routes.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${active === href ? 'selected' : ''}`} aria-current={active === href ? 'page' : undefined} onClick={() => setOpen(false)}>
            <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
          </Link>)}
        </nav>
      </aside>
    </>}
  </>;
}
