'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LogOut, Percent, ReceiptText, Store, TrendingUp } from 'lucide-react';
import { defaultProductCategories, isStoredCurrencyRate, isStoredCurrencyRows, isStoredExpenseLedger, isStoredProductIncreases, isStoredSellingEntries, readVersioned, readVersionedRaw, storageKeys, writeVersioned, type CurrencyRateSnapshot, type CurrencyRow, type ExpenseLedgerEntry, type ProductIncrease, type SellingEntry } from '@/lib/storage';
import { MobileFinanceNav } from '@/components/mobile-finance-nav';
import { getSharedDataDiagnostics, loadSharedDashboardValue, readCachedSharedDashboardValue, reconcileSharedReferences } from '@/lib/shared-dashboard';
import { setSharedDataDiagnostics, type SharedDataDiagnostic } from '@/lib/shared-data-diagnostics';
import { calculateCompanyGrowth } from '@/lib/financial-calculations';
import { fetchWithDataLoading } from '@/lib/data-fetch';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const moneyOrDash = (value: number | null) => value === null ? '—' : money(value);
const safeLegacyExpenses = (value: unknown): value is { id: string; amount: number; note: string; date: string }[] => Array.isArray(value) && value.every(item => !!item && typeof item === 'object' && typeof item.id === 'string' && Number.isFinite(item.amount) && item.amount >= 0 && typeof item.note === 'string' && typeof item.date === 'string' && Number.isFinite(Date.parse(item.date)));

export default function CompanyGrowthClient({ userName }: { userName: string }) {
  const [rows, setRows] = useState<CurrencyRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseLedgerEntry[]>([]);
  const [legacyExpenses, setLegacyExpenses] = useState<{ id: string; amount: number; note: string; date: string }[]>([]);
  const [rate, setRate] = useState<CurrencyRateSnapshot | null>(null);
  const [increases, setIncreases] = useState<ProductIncrease[]>([]);
  const [sales, setSales] = useState<SellingEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [notice, setNotice] = useState('');
  const [validationIssues, setValidationIssues] = useState<SharedDataDiagnostic[]>([]);
  const [expenseDataKnown, setExpenseDataKnown] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async <T,>(key: typeof storageKeys.currencyRows | typeof storageKeys.currencyRate | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries, validate: (value: unknown) => value is T, fallback: T): Promise<T> => {
      try { return await loadSharedDashboardValue(key, validate) ?? fallback; }
      catch { if (active) { setStorageHealthy(false); setNotice('Shared company data is unavailable. Showing saved data on this device.'); } return readCachedSharedDashboardValue(key, validate) ?? fallback; }
    };
    void (async () => {
      const [savedRows, savedRate, savedIncreases, savedSales] = await Promise.all([
        load(storageKeys.currencyRows, isStoredCurrencyRows, [] as CurrencyRow[]),
        load(storageKeys.currencyRate, isStoredCurrencyRate, null),
        load(storageKeys.productIncreases, isStoredProductIncreases, [] as ProductIncrease[]),
        load(storageKeys.sellingEntries, isStoredSellingEntries, [] as SellingEntry[]),
      ]);
      if (!active) return;
      const safeRead = reconcileSharedReferences(savedRows, savedIncreases, savedSales, { rateAvailable: savedRate !== null });
      setRows(safeRead.rows); setRate(savedRate); setIncreases(safeRead.increases); setSales(safeRead.sales);
      const rawLegacyExpenses = readVersionedRaw(storageKeys.companyExpenses);
      const savedLegacyExpenses = rawLegacyExpenses !== null && safeLegacyExpenses(rawLegacyExpenses) ? rawLegacyExpenses : [];
      setLegacyExpenses(savedLegacyExpenses);
      if (rawLegacyExpenses !== null && !safeLegacyExpenses(rawLegacyExpenses)) {
        setSharedDataDiagnostics('legacy-company-expenses', [{ dataset: storageKeys.companyExpenses, recordIndex: null, field: '$', rule: 'invalid_legacy_expense_snapshot', status: 'financial_calculation_incomplete' }]);
      } else if (savedLegacyExpenses.length > 0) {
        setSharedDataDiagnostics('legacy-company-expenses', [{ dataset: storageKeys.companyExpenses, recordIndex: null, field: '$', rule: 'browser_local_legacy_expenses_not_shared', status: 'financial_calculation_incomplete' }]);
      } else setSharedDataDiagnostics('legacy-company-expenses', []);
      setExpenses(readVersioned(storageKeys.expenseLedger, isStoredExpenseLedger) ?? []);
      try {
        const response = await fetchWithDataLoading('/api/expense-ledger', { cache: 'no-store' });
        if (!response.ok) throw new Error('Expense service unavailable');
        const result = await response.json() as { entries?: ExpenseLedgerEntry[] };
        if (Array.isArray(result.entries) && isStoredExpenseLedger(result.entries)) {
          const pending = (readVersioned(storageKeys.expenseLedger, isStoredExpenseLedger) ?? []).filter(entry => entry.localOnly);
          const combined = [...pending, ...result.entries].filter((entry, index, all) => all.findIndex(candidate => candidate.id === entry.id) === index);
          if (active) setExpenses(combined);
          writeVersioned(storageKeys.expenseLedger, combined);
          if (active) setExpenseDataKnown(pending.length === 0);
          setSharedDataDiagnostics('expense-ledger', pending.length === 0 ? [] : [{ dataset: storageKeys.expenseLedger, recordIndex: null, field: 'localOnly', rule: 'unsynced_expense_draft_excluded_from_company_totals', status: 'financial_calculation_incomplete' }]);
        } else {
          if (active) setExpenseDataKnown(false);
          setSharedDataDiagnostics('expense-ledger', [{ dataset: storageKeys.expenseLedger, recordIndex: null, field: '$', rule: 'invalid_expense_ledger_snapshot', status: 'financial_calculation_incomplete' }]);
        }
      } catch { if (active) { setNotice('Could not refresh the shared expense ledger; showing saved records.'); setExpenseDataKnown(false); } setSharedDataDiagnostics('expense-ledger', [{ dataset: storageKeys.expenseLedger, recordIndex: null, field: '$', rule: 'expense_ledger_unavailable', status: 'financial_calculation_incomplete' }]); }
      try {
        const response = await fetchWithDataLoading('/api/auth/status', { cache: 'no-store' });
        if (response.ok) { const status = await response.json() as { mode?: string }; if (active) setStorageHealthy(status.mode === 'supabase'); }
      } catch { if (active) setStorageHealthy(false); }
      if (active) setValidationIssues(getSharedDataDiagnostics());
      if (active) setReady(true);
    })();
    return () => { active = false; };
  }, []);
  const metrics = useMemo(() => {
    const active = rows.filter(row => row.active);
    const excludedCoreRecords = validationIssues.some(issue => issue.status === 'excluded_from_view_and_calculations' || issue.status === 'excluded_from_financial_calculations');
    const legacyExpenseUnknown = validationIssues.some(issue => issue.dataset === storageKeys.companyExpenses);
    const ledgerExpenses = expenseDataKnown ? expenses.reduce((sum, item) => sum + item.amount, 0) : null;
    const operatingExpenses = ledgerExpenses === null || legacyExpenseUnknown ? null : ledgerExpenses + legacyExpenses.reduce((sum, item) => sum + item.amount, 0);
    const summary = calculateCompanyGrowth({ rows, increases, sales, rate, operatingExpenses, ledgerExpenses, hasExcludedRecords: excludedCoreRecords });
    const sellById = new Map(increases.map(item => [item.sourceId, item.increaseInr]));
    const retailById = new Map(sales.map(item => [item.sourceId, item]));
    const extraCategories = Array.from(new Set(active.map(row => row.category).filter((category): category is string => !!category && !defaultProductCategories.includes(category))));
    const byCategory = [...defaultProductCategories, ...extraCategories].map(category => ({ category, stock: active.filter(row => (row.category ?? 'Ring') === category).reduce((sum, row) => sum + Math.max(0, row.productCount - (retailById.get(row.id)?.soldCount ?? 0) - (retailById.get(row.id)?.retailerSoldCount ?? 0)), 0) })).filter(item => item.stock > 0 || active.some(row => (row.category ?? 'Ring') === item.category));
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (5 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthRows = active.filter(row => sales.some(sale => sale.sourceId === row.id && (sale.soldCount > 0 && sale.updatedAt.slice(0, 7) === key || (sale.retailerSoldCount ?? 0) > 0 && (sale.retailerUpdatedAt ?? sale.updatedAt).slice(0, 7) === key)));
      let monthlyRevenue: number | null = 0;
      for (const row of monthRows) {
        const sale = retailById.get(row.id);
        const directThisMonth = sale?.updatedAt.slice(0, 7) === key && sale.soldCount > 0;
        const retailThisMonth = (sale?.retailerUpdatedAt ?? sale?.updatedAt)?.slice(0, 7) === key && (sale?.retailerSoldCount ?? 0) > 0;
        if (directThisMonth && sellById.get(row.id) === undefined) monthlyRevenue = null;
        else if (directThisMonth && monthlyRevenue !== null) monthlyRevenue += (sellById.get(row.id) ?? 0) * (sale?.soldCount ?? 0);
        if (retailThisMonth && sale?.retailerAmountInr === undefined) monthlyRevenue = null;
        else if (retailThisMonth && monthlyRevenue !== null) monthlyRevenue += (sale?.retailerAmountInr ?? 0) * (sale?.retailerSoldCount ?? 0);
      }
      if (excludedCoreRecords) monthlyRevenue = null;
      return { label: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(date), revenue: monthlyRevenue };
    });
    return { ...summary, byCategory, months };
  }, [rows, increases, sales, expenses, legacyExpenses, rate, validationIssues, expenseDataKnown]);
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };
  const maxRevenue = Math.max(...metrics.months.map(item => item.revenue ?? 0), 1);
  const expenseNotes = [...expenses].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return <main className="page-shell"><div className="dashboard currency-dashboard growth-dashboard">
    <aside className="sidebar currency-sidebar"><Link href="/" className="brand currency-brand"><BrandLogo /></Link><nav className="primary-nav" aria-label="Main navigation"><Link className="nav-link" href="/"><LayoutDashboard size={19}/><span>Dashboard</span></Link><Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19}/><span>Currency Exchange</span></Link><Link className="nav-link" href="/product-percentage"><Percent size={19}/><span>Product Percentage</span></Link><Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19}/><span>Selling Details</span></Link><Link className="nav-link" href="/ellext-retailers"><Store size={19}/><span>Retailers</span></Link><Link className="nav-link" href="/expense-ledger"><ReceiptText size={19}/><span>Expense Ledger</span></Link><Link className="nav-link selected" href="/company-growth"><TrendingUp size={19}/><span>Company Growth</span></Link></nav><div className="currency-sidebar-note"><span className="currency-rate-icon"><TrendingUp size={18}/></span><span>COMPANY STATUS<br/><b>{storageHealthy ? 'Operational' : 'Storage issue'}</b></span></div><button className="logout currency-logout" onClick={signOut}><LogOut size={17}/> Sign out</button></aside>
    <section className="main-panel currency-main growth-main"><header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/company-growth"/><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · PRIVATE REPORT</span><h1>Company Growth</h1><p>Margins, sales performance, and live stock overview.</p></div><span className={`growth-status ${storageHealthy ? 'growth-online' : 'growth-offline'}`}><i/>{storageHealthy ? 'Company data available' : 'Local storage unavailable'}</span></header>
      <section className="growth-kpis"><article><span>SALES REVENUE</span><strong>{moneyOrDash(metrics.revenue)}</strong><small>{metrics.soldUnits.toLocaleString('en-IN')} eligible units sold</small></article><article><span>GROSS PROFIT</span><strong>{moneyOrDash(metrics.grossProfit)}</strong><small>Revenue less verified purchase cost</small></article><article><span>GROSS MARGIN</span><strong>{metrics.grossMargin === null ? '—' : `${metrics.grossMargin.toFixed(1)}%`}</strong><small>Gross profit ÷ sales revenue</small></article><article><span>OPERATING EXPENSES</span><strong>{moneyOrDash(metrics.operatingExpenses)}</strong><small>Verified Expense Ledger total</small></article><article><span>NET PROFIT</span><strong>{moneyOrDash(metrics.netProfit)}</strong><small>Gross profit less verified expenses</small></article><article><span>NET MARGIN</span><strong>{metrics.netMargin === null ? '—' : `${metrics.netMargin.toFixed(1)}%`}</strong><small>Net profit ÷ sales revenue</small></article></section>
      <section className="growth-panel retailer-growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">SEPARATE SALES CHANNEL</span><h2>Retailer sales</h2></div><Link href="/ellext-retailers" className="expense-growth-link"><Store size={15}/> Manage retailer sales</Link></div><div className="retailer-growth-summary"><article><span>ITEMS SOLD TO RETAILERS</span><b>{metrics.retailerSoldUnits.toLocaleString('en-IN')}</b></article><article><span>RETAILER COLLECTION</span><b>{moneyOrDash(metrics.retailerRevenue)}</b></article></div>{metrics.retailerRows.length ? <div className="retailer-growth-list">{metrics.retailerRows.map(({row,amount,count})=><div key={row.id}><span><b>{row.category || 'Product'} · {row.description}</b><small>{count.toLocaleString('en-IN')} retailer items × {moneyOrDash(amount)}</small></span><strong>{amount === null && count > 0 ? '—' : money(count*(amount ?? 0))}</strong></div>)}</div> : <p className="growth-empty-note">Retailer sales will appear here after the Admin saves retailer amounts and sold counts.</p>}</section>
      <div className="growth-columns"><section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">PERFORMANCE</span><h2>Revenue trend</h2></div><span>Last 6 months</span></div><div className="growth-chart" role="img" aria-label="Monthly sales revenue for the past six months">{metrics.months.map(item => <div className="growth-bar-column" key={item.label}><b>{moneyOrDash(item.revenue)}</b><div><i style={{ height: `${Math.max(4, (item.revenue ?? 0) / maxRevenue * 100)}%` }}/></div><small>{item.label}</small></div>)}</div><div className="growth-profit-line"><span>Net profit after expenses</span><b>{moneyOrDash(metrics.netProfit)}</b></div></section>
        <section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">OPERATING COSTS</span><h2>Expense summary</h2></div><b>{moneyOrDash(metrics.operatingExpenses)}</b></div><ul className="growth-expense-list"><li><span><b>Expense Ledger</b><small>{expenseDataKnown ? `${expenses.length} entries recorded by the Admin team` : 'Expense totals unavailable'}</small></span><strong>{moneyOrDash(metrics.ledgerExpenses)}</strong></li><li><span><b>Net profit</b><small>Gross profit less verified operating expenses</small></span><strong>{moneyOrDash(metrics.netProfit)}</strong></li></ul><div className="growth-ledger-notes"><b>Latest expense notes</b>{expenseNotes.length ? expenseNotes.slice(0,5).map(item => <div key={item.id}><span>{item.note}<small>{item.category}</small></span><strong>{money(item.amount)}</strong></div>) : <small>No expense notes have been added yet.</small>}</div><Link className="expense-growth-link" href="/expense-ledger"><ReceiptText size={15}/> Open expense ledger</Link></section></div>
      <div className="growth-columns growth-lower"><section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">INVENTORY</span><h2>Live stock by category</h2></div><b>{metrics.stock.toLocaleString('en-IN')} eligible total</b></div><div className="growth-stock-list">{metrics.byCategory.map(item => <div key={item.category}><span>{item.category}</span><b>{item.stock.toLocaleString('en-IN')} in stock</b><i><em style={{ width: `${metrics.stock ? Math.max(2,item.stock / metrics.stock * 100) : 0}%` }}/></i></div>)}{metrics.byCategory.length === 0 && <p className="growth-empty-note">Add product purchases to populate stock by category.</p>}</div></section><section className="growth-panel growth-health"><div className="growth-panel-title"><div><span className="currency-kicker">OPERATIONS</span><h2>Company status</h2></div><span className={`growth-status ${storageHealthy ? 'growth-online' : 'growth-offline'}`}><i/>{storageHealthy ? 'Live' : 'Issue'}</span></div><div className="growth-health-row"><span className="growth-health-icon"><Check size={18}/></span><div><b>{storageHealthy ? 'Dashboard operating normally' : 'Browser storage unavailable'}</b><small>{ready ? 'Dashboard records are loaded from this browser.' : 'Checking dashboard data…'}</small></div></div><div className="growth-health-row"><span className="growth-health-icon"><TrendingUp size={18}/></span><div><b>Exchange reference rate</b><small>{rate ? `1 USD = ${rate.usdToInr.toFixed(4)} INR` : 'No verified current rate stored'}</small></div></div><p>Signed in as {userName}. Growth reports are visible to Super Admin only.</p></section></div>
    </section>
  </div>{notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}</main>;
}
