'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, ChartNoAxesColumnIncreasing, LayoutDashboard, LockKeyhole, LogOut, Percent, Plus, ReceiptText, Store, UnlockKeyhole, X } from 'lucide-react';
import { isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, storageKeys, type CurrencyRow, type ProductIncrease, type SellingEntry } from '../../lib/storage';
import { MobileFinanceNav } from '../../components/mobile-finance-nav';
import { loadSharedDashboardValue, readCachedSharedDashboardValue, reconcileSharedReferences, saveSharedDashboardRow } from '../../lib/shared-dashboard';
import { fetchWithDataLoading } from '@/lib/data-fetch';

const formatMoney = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export default function SellingDetailsPage() {
  const [sourceRows, setSourceRows] = useState<CurrencyRow[]>([]);
  const [increases, setIncreases] = useState<ProductIncrease[]>([]);
  const [entries, setEntries] = useState<SellingEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CurrencyRow | null>(null);
  const [notice, setNotice] = useState('');
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  useEffect(() => {
    let active = true;
    const load = async <T,>(key: typeof storageKeys.currencyRows | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries, validate: (value: unknown) => value is T, fallback: T): Promise<T> => {
      try { return await loadSharedDashboardValue(key, validate) ?? fallback; }
      catch { if (active) setNotice('Shared company data is unavailable. Device data was preserved for recovery; reconnect before editing shared records.'); return readCachedSharedDashboardValue(key, validate) ?? fallback; }
    };
    void (async () => {
      const [rows, savedIncreases, savedEntries] = await Promise.all([
        load(storageKeys.currencyRows, isStoredCurrencyRows, [] as CurrencyRow[]),
        load(storageKeys.productIncreases, isStoredProductIncreases, [] as ProductIncrease[]),
        load(storageKeys.sellingEntries, isStoredSellingEntries, [] as SellingEntry[]),
      ]);
      if (!active) return;
      const safeRead = reconcileSharedReferences(rows, savedIncreases, savedEntries);
      setSourceRows(safeRead.rows); setIncreases(safeRead.increases); setEntries(safeRead.sales);
      setDrafts(Object.fromEntries(safeRead.sales.map(entry => [entry.sourceId, String(entry.soldCount)])));
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rows = useMemo(() => sourceRows.filter(row => row.active), [sourceRows]);
  const companyAmountMap = useMemo(() => new Map(increases.map(item => [item.sourceId, item.increaseInr])), [increases]);
  const entryMap = useMemo(() => new Map(entries.map(entry => [entry.sourceId, entry])), [entries]);
  const totals = useMemo(() => rows.reduce((total, row) => {
    const sold = entryMap.get(row.id)?.soldCount ?? 0;
    const sellingUnit = companyAmountMap.get(row.id) ?? null;
    return { sold: total.sold + sold, collected: sellingUnit === null ? total.collected : total.collected + sold * sellingUnit, complete: total.complete && (sold === 0 || sellingUnit !== null) };
  }, { sold: 0, collected: 0, complete: true }), [rows, entryMap, companyAmountMap]);

  const saveSoldCount = async (row: CurrencyRow) => {
    const rawValue = drafts[row.id] ?? '0';
    const soldCount = Number(rawValue);
    const retailSold = entryMap.get(row.id)?.retailerSoldCount ?? 0;
    const directLimit = Math.max(0, row.productCount - retailSold);
    if (!Number.isInteger(soldCount) || soldCount < 0 || soldCount > directLimit) {
      setErrors(current => ({ ...current, [row.id]: `Enter 0–${directLimit} sold items after retailer sales.` }));
      return;
    }
    const entry: SellingEntry = { ...entryMap.get(row.id), sourceId: row.id, soldCount, updatedAt: new Date().toISOString() };
    try {
      const storageMode = await saveSharedDashboardRow(storageKeys.sellingEntries, entry, entryMap.get(row.id) ?? null);
      setEntries(current => [...current.filter(item => item.sourceId !== row.id), entry]);
      setEditingIds(current => current.filter(id => id !== row.id));
      setErrors(current => ({ ...current, [row.id]: '' }));
      setNotice(storageMode === 'sqlite' ? `Saved locally only for ${row.description}; Supabase is unavailable, so other accounts will not see this update yet.` : `Sales updated for ${row.description}`);
    } catch (cause) {
      setErrors(current => ({ ...current, [row.id]: cause instanceof Error ? `${cause.message} The entry was preserved for recovery.` : 'Could not save the sold count.' }));
    }
  };
  const unlockSoldCount = (row: CurrencyRow) => {
    setDrafts(current => ({ ...current, [row.id]: String(entryMap.get(row.id)?.soldCount ?? 0) }));
    setEditingIds(current => current.includes(row.id) ? current : [...current, row.id]);
    setErrors(current => ({ ...current, [row.id]: '' }));
    setNotice(`Sold item count unlocked for ${row.description}`);
  };
  const lockSoldCount = (row: CurrencyRow) => {
    setDrafts(current => ({ ...current, [row.id]: String(entryMap.get(row.id)?.soldCount ?? 0) }));
    setEditingIds(current => current.filter(id => id !== row.id));
    setErrors(current => ({ ...current, [row.id]: '' }));
    setNotice(`Sold item count locked for ${row.description}`);
  };
  const changeSoldDraft = (row: CurrencyRow, value: string) => {
    setDrafts(current => ({ ...current, [row.id]: value }));
    setErrors(current => ({ ...current, [row.id]: '' }));
  };

  return <main className="page-shell">
    <div className="dashboard currency-dashboard selling-dashboard">
      <aside className="sidebar currency-sidebar">
        <Link href="/" className="brand currency-brand"><BrandLogo /></Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <Link className="nav-link" href="/"><LayoutDashboard size={19} strokeWidth={1.8} /><span>Dashboard</span></Link>
          <Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19} strokeWidth={1.8} /><span>Currency Exchange</span></Link>
          <Link className="nav-link" href="/product-percentage"><Percent size={19} strokeWidth={1.8} /><span>Product Percentage</span></Link>
          <Link className="nav-link selected" href="/selling-details"><ChartNoAxesColumnIncreasing size={19} strokeWidth={1.8} /><span>Selling Details</span></Link>
          <Link className="nav-link" href="/ellext-retailers"><Store size={19} strokeWidth={1.8} /><span>Retailers</span></Link>
          <Link className="nav-link" href="/expense-ledger"><ReceiptText size={19} strokeWidth={1.8} /><span>Expense Ledger</span></Link>
        </nav>
        <div className="currency-sidebar-note"><span className="currency-rate-icon"><ChartNoAxesColumnIncreasing size={18} /></span><span>Units sold<br /><b>{totals.sold.toLocaleString('en-IN')}</b></span></div>
        <button className="logout currency-logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </aside>

      <section className="main-panel currency-main selling-main">
        <header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/selling-details" /><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · SALES</span><h1>Selling Details</h1><p>Record sold items and collected amounts.</p></div><Link href="/expense-ledger" className="currency-add"><Plus size={17}/> Expense ledger</Link></header>
        <div className="selling-summary">
          <article><span>SOLD ITEMS</span><strong>{totals.sold.toLocaleString('en-IN')}</strong><small>of {rows.reduce((sum, row) => sum + row.productCount, 0).toLocaleString('en-IN')} active products</small></article>
          <article><span>COLLECTED AMOUNT</span><strong>{totals.complete ? formatMoney(totals.collected) : '—'}</strong><small>{totals.complete ? 'Sold count × company selling amount' : 'Unavailable: a sold record has no saved company selling amount'}</small></article>
          <Link href="/expense-ledger" className="selling-summary-link"><Plus size={17} /><span>Operating expenses<br /><b>Open expense ledger</b></span></Link>
          <Link href="/product-percentage" className="selling-summary-link"><Percent size={17} /><span>Company selling amounts<br /><b>Manage product pricing</b></span></Link>
        </div>
        <div className="currency-table-heading"><div><h2>Product sales rows</h2><p>{rows.length} active product {rows.length === 1 ? 'row' : 'rows'} from Currency Exchange</p></div></div>
        {rows.length > 0 ? <><div className="currency-table-wrap selling-table-wrap selling-desktop-table"><table className="currency-table selling-table"><thead><tr><th>Date</th><th>Image</th><th>Description</th><th>Company amount</th><th>Product count</th><th>Sold items</th><th>Collected amount</th></tr></thead>
          <tbody>{rows.map(row => {
            const companyAmount = companyAmountMap.get(row.id);
            const unitSell = companyAmount ?? null;
            const soldCount = entryMap.get(row.id)?.soldCount ?? 0;
            const collected = unitSell === null && soldCount > 0 ? null : (unitSell ?? 0) * soldCount;
            return <tr key={row.id}>
              <td className="currency-date">{formatDate(row.date)}</td>
              <td><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button></td>
              <td className="currency-description" title={row.description}><span>{row.description}</span></td>
              <td className="currency-money">{companyAmount === undefined ? '—' : formatMoney(companyAmount)}</td>
              <td><span className="product-count-pill">{row.productCount.toLocaleString('en-IN')}</span></td>
              <td><div className={`selling-count-editor ${editingIds.includes(row.id) ? 'count-editing' : 'count-locked'}`}><label className="visually-hidden" htmlFor={`sold-${row.id}`}>Sold item count for {row.description}</label><input id={`sold-${row.id}`} type="number" min="0" max={Math.max(0,row.productCount-(entryMap.get(row.id)?.retailerSoldCount??0))} step="1" value={drafts[row.id] ?? '0'} disabled={!editingIds.includes(row.id)} onChange={event => changeSoldDraft(row, event.target.value)} />{editingIds.includes(row.id) ? <><button onClick={() => saveSoldCount(row)} aria-label={`Save and lock sold count for ${row.description}`} title="Save and lock"><Check size={15} /></button><button className="count-lock-button" onClick={() => lockSoldCount(row)} aria-label={`Cancel and lock sold count for ${row.description}`} title="Cancel and lock"><LockKeyhole size={14} /></button></> : <button className="count-unlock-button" onClick={() => unlockSoldCount(row)} aria-label={`Unlock sold count for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button>}{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div></td>
              <td className="currency-money">{collected === null ? '—' : formatMoney(collected)}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="selling-mobile-list">{rows.map(row => {
          const companyAmount = companyAmountMap.get(row.id);
          const unitSell = companyAmount ?? null;
          const soldCount = entryMap.get(row.id)?.soldCount ?? 0;
          const collected = unitSell === null && soldCount > 0 ? null : (unitSell ?? 0) * soldCount;
          return <article className="selling-mobile-card" key={row.id}>
            <div className="selling-mobile-head"><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button><div><span>{formatDate(row.date)}</span><b>{row.description}</b></div></div>
            <div className="selling-mobile-values"><div><span>Company amount</span><b>{companyAmount === undefined ? '—' : formatMoney(companyAmount)}</b></div><div><span>Products available</span><b>{row.productCount.toLocaleString('en-IN')}</b></div><div><span>Collected</span><b>{collected === null ? '—' : formatMoney(collected)}</b></div><div><span>Sold items</span><div className={`selling-count-editor ${editingIds.includes(row.id) ? 'count-editing' : 'count-locked'}`}><label className="visually-hidden" htmlFor={`mobile-sold-${row.id}`}>Sold item count for {row.description}</label><input id={`mobile-sold-${row.id}`} type="number" min="0" max={Math.max(0,row.productCount-(entryMap.get(row.id)?.retailerSoldCount??0))} step="1" value={drafts[row.id] ?? '0'} disabled={!editingIds.includes(row.id)} onChange={event => changeSoldDraft(row, event.target.value)} />{editingIds.includes(row.id) ? <><button onClick={() => saveSoldCount(row)} aria-label={`Save and lock sold count for ${row.description}`} title="Save and lock"><Check size={15} /></button><button className="count-lock-button" onClick={() => lockSoldCount(row)} aria-label={`Cancel and lock sold count for ${row.description}`} title="Cancel and lock"><LockKeyhole size={14} /></button></> : <button className="count-unlock-button" onClick={() => unlockSoldCount(row)} aria-label={`Unlock sold count for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button>}{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div></div></div>
          </article>;
        })}</div></> : <div className="currency-empty percentage-empty-state"><span className="currency-empty-icon"><ChartNoAxesColumnIncreasing size={20} /></span><strong>No products to record sales for</strong><p>Add active product rows in Currency Exchange. They will appear here with their company selling amount and available product count.</p><Link href="/currency-exchange" className="currency-empty-link"><ArrowLeftRight size={15} /> Go to Currency Exchange</Link></div>}
        <footer className="currency-source"><span className="rate-dot" />Collected amount = sold item count × company amount. Record operating expenses in the Expense Ledger to update Company Growth.</footer>
      </section>
    </div>
    {preview && <div className="modal-scrim image-preview-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><section className="image-preview-card" role="dialog" aria-modal="true" aria-label={`${preview.description} image preview`}><button className="modal-close image-preview-close" onClick={() => setPreview(null)} aria-label="Close image preview"><X size={18} /></button><Image src={preview.image} alt={preview.description} fill sizes="(max-width: 700px) 90vw, 640px" unoptimized /><p>{preview.description}</p></section></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
  </main>;
}
