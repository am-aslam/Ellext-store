'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, LayoutDashboard, LogOut, Menu, Percent, ReceiptText, ShieldCheck, ShoppingBag, Store, TrendingUp, X } from 'lucide-react';
import { isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, readVersioned, storageKeys, type CurrencyRow, type ProductIncrease, type SellingEntry } from '../lib/storage';
import { loadDashboardOverview } from '../lib/shared-dashboard';
import { fetchWithDataLoading } from '@/lib/data-fetch';

type DashboardSale = {
  row: CurrencyRow;
  sold: number;
  collected: number | null;
  updatedAt: string;
  hasLog: boolean;
};
type DashboardData = { rows: DashboardSale[]; sold: number; available: number; collected: number | null };
const emptyDashboard: DashboardData = { rows: [], sold: 0, available: 0, collected: null };
const formatInr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

function buildDashboardData(allRows: CurrencyRow[], increases: ProductIncrease[], sellingEntries: SellingEntry[]): DashboardData {
  const currencyRows = allRows.filter(row => row.active);
  const increaseById = new Map(increases.map(item => [item.sourceId, item.increaseInr]));
  const saleById = new Map(sellingEntries.map(item => [item.sourceId, item]));
  const rows = currencyRows
    .map(row => {
      const sale = saleById.get(row.id);
      const sold = sale?.soldCount ?? 0;
      const companyAmount = increaseById.get(row.id);
      const collected = companyAmount === undefined ? null : sold * companyAmount;
      return { row, sold, collected, updatedAt: sale?.updatedAt ?? row.date, hasLog: Boolean(sale) };
    })
    .sort((left, right) => Date.parse(right.row.date) - Date.parse(left.row.date));
  return {
    rows,
    sold: rows.reduce((total, item) => total + item.sold, 0),
    available: rows.reduce((total, item) => total + Math.max(0, item.row.productCount - item.sold), 0),
    collected: rows.some(item => item.collected !== null) ? rows.reduce((total, item) => total + (item.collected ?? 0), 0) : null,
  };
}

function DashboardSidebar({ open, onClose, data, isSuperAdmin }: { open: boolean; onClose: () => void; data: DashboardData; isSuperAdmin: boolean }) {
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };
  return <>
    {open && <button className="drawer-scrim" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar dashboard-sidebar ${open ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand dashboard-brand" onClick={onClose}><BrandLogo /></Link>
      <nav className="primary-nav" aria-label="Main navigation">
        <Link className="nav-link selected" href="/" onClick={onClose}><LayoutDashboard size={19} /><span>Dashboard</span></Link>
        <Link className="nav-link" href="/currency-exchange" onClick={onClose}><ArrowLeftRight size={19} /><span>Currency Exchange</span></Link>
        <Link className="nav-link" href="/product-percentage" onClick={onClose}><Percent size={19} /><span>Product Percentage</span></Link>
        <Link className="nav-link" href="/selling-details" onClick={onClose}><ChartNoAxesColumnIncreasing size={19} /><span>Selling Details</span></Link>
        <Link className="nav-link" href="/ellext-retailers" onClick={onClose}><Store size={19} /><span>Retailers</span></Link>
        <Link className="nav-link" href="/expense-ledger" onClick={onClose}><ReceiptText size={19} /><span>Expense Ledger</span></Link>
        {isSuperAdmin && <Link className="nav-link" href="/super-admin" onClick={onClose}><ShieldCheck size={19} /><span>Super Admin</span></Link>}
        {isSuperAdmin && <Link className="nav-link" href="/company-growth" onClick={onClose}><TrendingUp size={19} /><span>Company Growth</span></Link>}
      </nav>
      <section className="dashboard-side-summary"><span className="dashboard-side-icon"><ShoppingBag size={17} /></span><div><small>SALES SNAPSHOT</small><b>{data.sold.toLocaleString('en-IN')} items sold</b><span>{data.collected === null ? 'Set company selling amounts' : formatInr(data.collected)} collected</span></div></section>
      <Link href="/selling-details" className="dashboard-side-link" onClick={onClose}>Open selling details <span aria-hidden>↗</span></Link>
      <button className="logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
    </aside>
  </>;
}

export default function Dashboard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncWarning, setSyncWarning] = useState('');
  const reload = useCallback(async () => {
    let rows: CurrencyRow[];
    let increases: ProductIncrease[];
    let sales: SellingEntry[];
    let sharedReadError = '';
    try {
      const overview = await loadDashboardOverview();
      rows = overview.rows;
      increases = overview.increases;
      sales = overview.sales;
    } catch (cause) {
      sharedReadError = cause instanceof Error ? cause.message : 'Shared data request failed.';
      rows = readVersioned(storageKeys.currencyRows, isStoredCurrencyRows) ?? [];
      increases = readVersioned(storageKeys.productIncreases, isStoredProductIncreases) ?? [];
      sales = readVersioned(storageKeys.sellingEntries, isStoredSellingEntries) ?? [];
    }
    setData(buildDashboardData(rows, increases, sales));
    setSyncWarning(sharedReadError ? `${sharedReadError} Showing this browser’s cached data only; unsynced changes are not visible to other accounts.` : '');
  }, []);
  useEffect(() => {
    void reload();
    window.addEventListener('storage', reload);
    window.addEventListener('focus', reload);
    const interval = window.setInterval(() => void reload(), 15000);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('focus', reload);
      window.clearInterval(interval);
    };
  }, [reload]);

  const totalProducts = useMemo(() => data.rows.reduce((total, item) => total + item.row.productCount, 0), [data.rows]);
  const collectedRows = [...data.rows].filter(item => item.collected !== null && item.collected > 0).sort((a, b) => (b.collected ?? 0) - (a.collected ?? 0)).slice(0, 6);
  const soldRows = [...data.rows].filter(item => item.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 6);
  const salesLogs = [...data.rows].filter(item => item.hasLog).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
  const maxCollected = Math.max(...collectedRows.map(item => item.collected ?? 0), 0);
  const maxSold = Math.max(...soldRows.map(item => item.sold), 0);

  return <main className="page-shell dashboard-page-shell">
    <div className="dashboard dashboard-home">
      <DashboardSidebar open={menuOpen} onClose={() => setMenuOpen(false)} data={data} isSuperAdmin={isSuperAdmin} />
      <section className="main-panel dashboard-main">
        <header className="dashboard-header">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <div className="dashboard-heading"><span className="currency-kicker">ELLEXTSTORE · SALES OVERVIEW</span><h1>Dashboard</h1><p>Sales performance from your Selling Details.</p></div>
          <Link href="/selling-details" className="dashboard-view-sales"><ChartNoAxesColumnIncreasing size={16} /> View selling details</Link>
        </header>
        {syncWarning && <div className="dashboard-sync-warning" role="alert"><strong>Company data is not syncing</strong><span>{syncWarning}</span>{isSuperAdmin && <Link href="/super-admin">Check Supabase status</Link>}</div>}

        <section className="dashboard-kpis" aria-label="Sales summary">
          <article className="dashboard-kpi"><span>COLLECTED AMOUNT</span><strong>{data.collected === null ? '—' : formatInr(data.collected)}</strong><small>{data.collected === null ? 'Set company selling amounts in Product Percentage' : 'Sold items × company selling amount'}</small></article>
          <article className="dashboard-kpi"><span>ITEMS SOLD</span><strong>{data.sold.toLocaleString('en-IN')}</strong><small>Recorded in Selling Details</small></article>
          <article className="dashboard-kpi"><span>PRODUCTS AVAILABLE</span><strong>{data.available.toLocaleString('en-IN')}</strong><small>Across {data.rows.length.toLocaleString('en-IN')} active product rows</small></article>
          <article className="dashboard-kpi"><span>PRODUCTS TRACKED</span><strong>{totalProducts.toLocaleString('en-IN')}</strong><small>From Currency Exchange</small></article>
        </section>

        <section className="dashboard-analytics" aria-label="Sales charts and log">
          <div className="dashboard-chart-stack">
            <article className="dashboard-chart-card">
              <div className="dashboard-chart-heading"><div><span className="dashboard-chart-icon"><ChartNoAxesColumnIncreasing size={16} /></span><div><h2>Collected by product</h2><p>Sales value from sold items</p></div></div><strong>{data.collected === null ? '—' : formatInr(data.collected)}</strong></div>
              {data.collected === null ? <div className="dashboard-chart-empty">Set company selling amounts in Product Percentage to chart collected sales.</div> : collectedRows.length ? <div className="dashboard-bars">{collectedRows.map(item => <div className="dashboard-bar-row" key={item.row.id}><span title={item.row.description}>{item.row.description}</span><div className="dashboard-bar-track" role="progressbar" aria-label={`Collected value for ${item.row.description}`} aria-valuemin={0} aria-valuemax={maxCollected} aria-valuenow={item.collected ?? 0}><i className="collected-bar" style={{ width: `${maxCollected ? Math.max(3, (item.collected ?? 0) / maxCollected * 100) : 0}%` }} /></div><b>{formatInr(item.collected ?? 0)}</b></div>)}</div> : <div className="dashboard-chart-empty">Sold items will appear here when sales are recorded.</div>}
            </article>
            <article className="dashboard-chart-card">
              <div className="dashboard-chart-heading"><div><span className="dashboard-chart-icon units-icon"><ShoppingBag size={16} /></span><div><h2>Items sold by product</h2><p>Sold units from Selling Details</p></div></div><strong>{data.sold.toLocaleString('en-IN')}</strong></div>
              {soldRows.length ? <div className="dashboard-bars">{soldRows.map(item => <div className="dashboard-bar-row" key={item.row.id}><span title={item.row.description}>{item.row.description}</span><div className="dashboard-bar-track" role="progressbar" aria-label={`Sold count for ${item.row.description}`} aria-valuemin={0} aria-valuemax={maxSold} aria-valuenow={item.sold}><i className="sold-bar" style={{ width: `${maxSold ? Math.max(3, item.sold / maxSold * 100) : 0}%` }} /></div><b>{item.sold.toLocaleString('en-IN')}</b></div>)}</div> : <div className="dashboard-chart-empty">Sold item counts will appear here once entered.</div>}
            </article>
          </div>
          <aside className="dashboard-log-card" aria-labelledby="dashboard-log-title">
            <div className="dashboard-log-heading"><div><span className="dashboard-log-icon"><ChartNoAxesColumnIncreasing size={15} /></span><div><h2 id="dashboard-log-title">Recent sales log</h2><p>Latest saved sales entries</p></div></div><Link href="/selling-details" aria-label="Open all selling details">See all <span aria-hidden>→</span></Link></div>
            {salesLogs.length ? <div className="dashboard-log-list">{salesLogs.map(item => <article className="dashboard-log-item" key={item.row.id}><span className="dashboard-log-image" aria-hidden><ShoppingBag size={16} /></span><div className="dashboard-log-copy"><b title={item.row.description}>{item.row.description}</b><small>{formatDate(item.updatedAt)} · {item.sold.toLocaleString('en-IN')} sold</small></div><strong>{item.collected === null ? '—' : formatInr(item.collected)}</strong></article>)}</div> : <div className="dashboard-log-empty"><span className="dashboard-empty-icon"><ChartNoAxesColumnIncreasing size={18} /></span><b>No sales log yet</b><p>Saved sold counts will show here.</p><Link href="/selling-details">Record sales</Link></div>}
          </aside>
        </section>
      </section>
    </div>
  </main>;
}
