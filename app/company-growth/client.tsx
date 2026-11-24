'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LogOut, Percent, ReceiptText, Store, TrendingUp } from 'lucide-react';
import { defaultProductCategories, isStoredCurrencyRate, isStoredCurrencyRows, isStoredExpenseLedger, isStoredProductIncreases, isStoredSellingEntries, readVersioned, storageKeys, writeVersioned, type CurrencyRow, type ExpenseLedgerEntry, type ProductIncrease, type SellingEntry } from '@/lib/storage';
import { MobileFinanceNav } from '@/components/mobile-finance-nav';
import { loadSharedDashboardValue } from '@/lib/shared-dashboard';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const safeLegacyExpenses = (value: unknown): value is { id: string; amount: number; note: string; date: string }[] => Array.isArray(value) && value.every(item => !!item && typeof item === 'object' && typeof item.id === 'string' && Number.isFinite(item.amount) && item.amount >= 0 && typeof item.note === 'string' && typeof item.date === 'string');

export default function CompanyGrowthClient({ userName }: { userName: string }) {
  const [rows, setRows] = useState<CurrencyRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseLedgerEntry[]>([]);
  const [legacyExpenses, setLegacyExpenses] = useState<{ id: string; amount: number; note: string; date: string }[]>([]);
  const [rate, setRate] = useState(0);
  const [increases, setIncreases] = useState<ProductIncrease[]>([]);
  const [sales, setSales] = useState<SellingEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const load = async <T,>(key: typeof storageKeys.currencyRows | typeof storageKeys.currencyRate | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries, validate: (value: unknown) => value is T, fallback: T): Promise<T> => {
      try { return await loadSharedDashboardValue(key, validate) ?? fallback; }
      catch { if (active) { setStorageHealthy(false); setNotice('Shared company data is unavailable. Showing saved data on this device.'); } return readVersioned(key, validate) ?? fallback; }
    };
    void (async () => {
      const [savedRows, savedRate, savedIncreases, savedSales] = await Promise.all([
        load(storageKeys.currencyRows, isStoredCurrencyRows, [] as CurrencyRow[]),
        load(storageKeys.currencyRate, isStoredCurrencyRate, null),
        load(storageKeys.productIncreases, isStoredProductIncreases, [] as ProductIncrease[]),
        load(storageKeys.sellingEntries, isStoredSellingEntries, [] as SellingEntry[]),
      ]);
      if (!active) return;
      setRows(savedRows); setRate(savedRate?.usdToInr ?? 0); setIncreases(savedIncreases); setSales(savedSales);
      setLegacyExpenses(readVersioned(storageKeys.companyExpenses, safeLegacyExpenses) ?? []);
      setExpenses(readVersioned(storageKeys.expenseLedger, isStoredExpenseLedger) ?? []);
      try {
        const response = await fetch('/api/expense-ledger', { cache: 'no-store' });
        if (!response.ok) throw new Error('Expense service unavailable');
        const result = await response.json() as { entries?: ExpenseLedgerEntry[] };
        if (Array.isArray(result.entries) && isStoredExpenseLedger(result.entries)) {
          const pending = (readVersioned(storageKeys.expenseLedger, isStoredExpenseLedger) ?? []).filter(entry => entry.localOnly);
          const combined = [...pending, ...result.entries].filter((entry, index, all) => all.findIndex(candidate => candidate.id === entry.id) === index);
          if (active) setExpenses(combined);
          writeVersioned(storageKeys.expenseLedger, combined);
        }
      } catch { if (active) setNotice('Could not refresh the shared expense ledger; showing saved records.'); }
      try {
        const response = await fetch('/api/auth/status', { cache: 'no-store' });
        if (response.ok) { const status = await response.json() as { mode?: string }; if (active) setStorageHealthy(status.mode === 'supabase'); }
      } catch { if (active) setStorageHealthy(false); }
      if (active) setReady(true);
    })();
    return () => { active = false; };
  }, []);
  const metrics = useMemo(() => {
    const active = rows.filter(row => row.active);
    const sellById = new Map(increases.map(item => [item.sourceId, item.increaseInr]));
    const soldById = new Map(sales.map(item => [item.sourceId, item.soldCount]));
    const retailById = new Map(sales.map(item => [item.sourceId, item]));
    const retailerSoldUnits = active.reduce((sum, row) => sum + (retailById.get(row.id)?.retailerSoldCount ?? 0), 0);
    const retailerRevenue = active.reduce((sum, row) => sum + (retailById.get(row.id)?.retailerAmountInr ?? 0) * (retailById.get(row.id)?.retailerSoldCount ?? 0), 0);
    const soldUnits = active.reduce((sum, row) => sum + (soldById.get(row.id) ?? 0), 0) + retailerSoldUnits;
    const revenue = active.reduce((sum, row) => sum + (sellById.get(row.id) ?? 0) * (soldById.get(row.id) ?? 0), 0) + retailerRevenue;
    const cogs = rate ? active.reduce((sum, row) => sum + row.usd * rate * ((soldById.get(row.id) ?? 0) + (retailById.get(row.id)?.retailerSoldCount ?? 0)), 0) : 0;
    const grossProfit = revenue - cogs;
    const ledgerExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const operatingExpenses = ledgerExpenses + legacyExpenses.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = grossProfit - operatingExpenses;
    const stock = active.reduce((sum, row) => sum + Math.max(0, row.productCount - (soldById.get(row.id) ?? 0) - (retailById.get(row.id)?.retailerSoldCount ?? 0)), 0);
    const extraCategories = Array.from(new Set(active.map(row => row.category).filter((category): category is string => !!category && !defaultProductCategories.includes(category))));
    const byCategory = [...defaultProductCategories, ...extraCategories].map(category => ({ category, stock: active.filter(row => (row.category ?? 'Ring') === category).reduce((sum, row) => sum + Math.max(0, row.productCount - (soldById.get(row.id) ?? 0) - (retailById.get(row.id)?.retailerSoldCount ?? 0)), 0) })).filter(item => item.stock > 0 || active.some(row => (row.category ?? 'Ring') === item.category));
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (5 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthRows = active.filter(row => sales.some(sale => sale.sourceId === row.id && (sale.soldCount > 0 && sale.updatedAt.slice(0, 7) === key || (sale.retailerSoldCount ?? 0) > 0 && (sale.retailerUpdatedAt ?? sale.updatedAt).slice(0, 7) === key)));
      const monthlyRevenue = monthRows.reduce((sum, row) => { const sale = retailById.get(row.id); const direct = sale?.updatedAt.slice(0, 7) === key ? (sellById.get(row.id) ?? 0) * (soldById.get(row.id) ?? 0) : 0; const retail = (sale?.retailerUpdatedAt ?? sale?.updatedAt)?.slice(0, 7) === key ? (sale?.retailerAmountInr ?? 0) * (sale?.retailerSoldCount ?? 0) : 0; return sum + direct + retail; }, 0);
      return { label: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(date), revenue: monthlyRevenue };
    });
    const retailerRows = active.filter(row => (retailById.get(row.id)?.retailerAmountInr ?? 0) > 0 || (retailById.get(row.id)?.retailerSoldCount ?? 0) > 0).map(row => ({ row, amount: retailById.get(row.id)?.retailerAmountInr ?? 0, count: retailById.get(row.id)?.retailerSoldCount ?? 0 }));
    return { soldUnits, revenue, retailerSoldUnits, retailerRevenue, retailerRows, cogs, grossProfit, operatingExpenses, ledgerExpenses, netProfit, grossMargin: revenue ? grossProfit / revenue * 100 : 0, netMargin: revenue ? netProfit / revenue * 100 : 0, stock, byCategory, months };
  }, [rows, increases, sales, expenses, legacyExpenses, rate]);
  const signOut = async () => { await fetch('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };
  const maxRevenue = Math.max(...metrics.months.map(item => item.revenue), 1);
  const expenseNotes = [...expenses].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return <main className="page-shell"><div className="dashboard currency-dashboard growth-dashboard">
    <aside className="sidebar currency-sidebar"><Link href="/" className="brand currency-brand"><BrandLogo /></Link><nav className="primary-nav" aria-label="Main navigation"><Link className="nav-link" href="/"><LayoutDashboard size={19}/><span>Dashboard</span></Link><Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19}/><span>Currency Exchange</span></Link><Link className="nav-link" href="/product-percentage"><Percent size={19}/><span>Product Percentage</span></Link><Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19}/><span>Selling Details</span></Link><Link className="nav-link" href="/ellext-retailers"><Store size={19}/><span>Retailers</span></Link><Link className="nav-link" href="/expense-ledger"><ReceiptText size={19}/><span>Expense Ledger</span></Link><Link className="nav-link selected" href="/company-growth"><TrendingUp size={19}/><span>Company Growth</span></Link></nav><div className="currency-sidebar-note"><span className="currency-rate-icon"><TrendingUp size={18}/></span><span>COMPANY STATUS<br/><b>{storageHealthy ? 'Operational' : 'Storage issue'}</b></span></div><button className="logout currency-logout" onClick={signOut}><LogOut size={17}/> Sign out</button></aside>
    <section className="main-panel currency-main growth-main"><header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/company-growth"/><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · PRIVATE REPORT</span><h1>Company Growth</h1><p>Margins, sales performance, and live stock overview.</p></div><span className={`growth-status ${storageHealthy ? 'growth-online' : 'growth-offline'}`}><i/>{storageHealthy ? 'Company data available' : 'Local storage unavailable'}</span></header>
      <section className="growth-kpis"><article><span>SALES REVENUE</span><strong>{money(metrics.revenue)}</strong><small>{metrics.soldUnits.toLocaleString('en-IN')} units sold</small></article><article><span>GROSS PROFIT</span><strong>{money(metrics.grossProfit)}</strong><small>Revenue less purchase cost</small></article><article><span>GROSS MARGIN</span><strong>{metrics.grossMargin.toFixed(1)}%</strong><small>Gross profit ÷ sales revenue</small></article><article><span>OPERATING EXPENSES</span><strong>{money(metrics.operatingExpenses)}</strong><small>Recorded in Expense Ledger</small></article><article><span>NET PROFIT</span><strong>{money(metrics.netProfit)}</strong><small>Gross profit less all expenses</small></article><article><span>NET MARGIN</span><strong>{metrics.netMargin.toFixed(1)}%</strong><small>Net profit ÷ sales revenue</small></article></section>
      <section className="growth-panel retailer-growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">SEPARATE SALES CHANNEL</span><h2>Retailer sales</h2></div><Link href="/ellext-retailers" className="expense-growth-link"><Store size={15}/> Manage retailer sales</Link></div><div className="retailer-growth-summary"><article><span>ITEMS SOLD TO RETAILERS</span><b>{metrics.retailerSoldUnits.toLocaleString('en-IN')}</b></article><article><span>RETAILER COLLECTION</span><b>{money(metrics.retailerRevenue)}</b></article></div>{metrics.retailerRows.length ? <div className="retailer-growth-list">{metrics.retailerRows.map(({row,amount,count})=><div key={row.id}><span><b>{row.category || 'Product'} · {row.description}</b><small>{count.toLocaleString('en-IN')} retailer items × {money(amount)}</small></span><strong>{money(count*amount)}</strong></div>)}</div> : <p className="growth-empty-note">Retailer sales will appear here after the Admin saves retailer amounts and sold counts.</p>}</section>
      <div className="growth-columns"><section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">PERFORMANCE</span><h2>Revenue trend</h2></div><span>Last 6 months</span></div><div className="growth-chart" role="img" aria-label="Monthly sales revenue for the past six months">{metrics.months.map(item => <div className="growth-bar-column" key={item.label}><b>{item.revenue ? money(item.revenue) : '—'}</b><div><i style={{ height: `${Math.max(4, item.revenue / maxRevenue * 100)}%` }}/></div><small>{item.label}</small></div>)}</div><div className="growth-profit-line"><span>Net profit after expenses</span><b>{money(metrics.netProfit)}</b></div></section>
        <section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">OPERATING COSTS</span><h2>Expense summary</h2></div><b>{money(metrics.operatingExpenses)}</b></div><ul className="growth-expense-list"><li><span><b>Expense Ledger</b><small>{expenses.length} entries recorded by the Admin team</small></span><strong>{money(metrics.ledgerExpenses)}</strong></li><li><span><b>Net profit</b><small>Gross profit less operating expenses</small></span><strong>{money(metrics.netProfit)}</strong></li></ul><div className="growth-ledger-notes"><b>Latest expense notes</b>{expenseNotes.length ? expenseNotes.slice(0,5).map(item => <div key={item.id}><span>{item.note}<small>{item.category}</small></span><strong>{money(item.amount)}</strong></div>) : <small>No expense notes have been added yet.</small>}</div><Link className="expense-growth-link" href="/expense-ledger"><ReceiptText size={15}/> Open expense ledger</Link></section></div>
      <div className="growth-columns growth-lower"><section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">INVENTORY</span><h2>Live stock by category</h2></div><b>{metrics.stock.toLocaleString('en-IN')} total</b></div><div className="growth-stock-list">{metrics.byCategory.map(item => <div key={item.category}><span>{item.category}</span><b>{item.stock.toLocaleString('en-IN')} in stock</b><i><em style={{ width: `${metrics.stock ? Math.max(2,item.stock / metrics.stock * 100) : 0}%` }}/></i></div>)}{metrics.byCategory.length === 0 && <p className="growth-empty-note">Add product purchases to populate stock by category.</p>}</div></section><section className="growth-panel growth-health"><div className="growth-panel-title"><div><span className="currency-kicker">OPERATIONS</span><h2>Company status</h2></div><span className={`growth-status ${storageHealthy ? 'growth-online' : 'growth-offline'}`}><i/>{storageHealthy ? 'Live' : 'Issue'}</span></div><div className="growth-health-row"><span className="growth-health-icon"><Check size={18}/></span><div><b>{storageHealthy ? 'Dashboard operating normally' : 'Browser storage unavailable'}</b><small>{ready ? 'Dashboard records are loaded from this browser.' : 'Checking dashboard data…'}</small></div></div><div className="growth-health-row"><span className="growth-health-icon"><TrendingUp size={18}/></span><div><b>Exchange reference rate</b><small>{rate ? `1 USD = ${rate.toFixed(4)} INR` : 'No current rate stored'}</small></div></div><p>Signed in as {userName}. Growth reports are visible to Super Admin only.</p></section></div>
    </section>
  </div>{notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}</main>;
}
