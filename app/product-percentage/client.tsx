'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LockKeyhole, LogOut, Pencil, Percent, ReceiptText, Share2, Store, UnlockKeyhole } from 'lucide-react';
import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, isStoredSellingEntries, storageKeys, type CurrencyRateSnapshot, type CurrencyRow, type ProductIncrease, type SellingEntry } from '../../lib/storage';
import { MobileFinanceNav } from '../../components/mobile-finance-nav';
import { loadSharedDashboardValue, saveSharedDashboardValue } from '../../lib/shared-dashboard';
import { shareProductWithImage } from '@/lib/product-share';
import { fetchWithDataLoading } from '@/lib/data-fetch';

const formatMoney = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export default function ProductPercentagePage() {
  const [sourceRows, setSourceRows] = useState<CurrencyRow[]>([]);
  const [sellingEntries, setSellingEntries] = useState<SellingEntry[]>([]);
  const [rate, setRate] = useState<CurrencyRateSnapshot | null>(null);
  const [increases, setIncreases] = useState<ProductIncrease[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<CurrencyRow | null>(null);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  useEffect(() => {
    let active = true;
    const load = async <T,>(key: typeof storageKeys.currencyRows | typeof storageKeys.currencyRate | typeof storageKeys.productIncreases | typeof storageKeys.sellingEntries, validate: (value: unknown) => value is T, fallback: T): Promise<T> => {
      try { return await loadSharedDashboardValue(key, validate) ?? fallback; }
      catch { if (active) setNotice('Shared company data is unavailable. Device data was preserved for recovery; reconnect before editing shared records.'); return fallback; }
    };
    void (async () => {
      const [rows, savedRate, savedIncreases, savedSellingEntries] = await Promise.all([
        load(storageKeys.currencyRows, isStoredCurrencyRows, [] as CurrencyRow[]),
        load(storageKeys.currencyRate, isStoredCurrencyRate, null),
        load(storageKeys.productIncreases, isStoredProductIncreases, [] as ProductIncrease[]),
        load(storageKeys.sellingEntries, isStoredSellingEntries, [] as SellingEntry[]),
      ]);
      if (!active) return;
      setSourceRows(rows); setRate(savedRate); setIncreases(savedIncreases); setSellingEntries(savedSellingEntries);
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rows = useMemo(() => sourceRows.filter(row => row.active), [sourceRows]);
  const increaseMap = useMemo(() => new Map(increases.map(item => [item.sourceId, item])), [increases]);
  const soldMap = useMemo(() => new Map(sellingEntries.map(item => [item.sourceId, (item.soldCount ?? 0) + (item.retailerSoldCount ?? 0)])), [sellingEntries]);
  const beginEdit = (row: CurrencyRow) => {
    const saved = increaseMap.get(row.id);
    setEditingIds(current => current.includes(row.id) ? current : [...current, row.id]);
    setDrafts(current => ({ ...current, [row.id]: saved ? String(saved.increaseInr) : current[row.id] ?? '' }));
    setErrors(current => ({ ...current, [row.id]: '' }));
  };
  const saveIncrease = async (row: CurrencyRow) => {
    const value = Number(drafts[row.id]);
    if (drafts[row.id]?.trim() === '' || !Number.isFinite(value) || value < 0) {
      setErrors(current => ({ ...current, [row.id]: 'Enter a valid company selling amount.' }));
      return;
    }
    const entry: ProductIncrease = { sourceId: row.id, increaseInr: value, locked: true, updatedAt: new Date().toISOString() };
    const nextIncreases = [...increases.filter(item => item.sourceId !== row.id), entry];
    try {
      const storageMode = await saveSharedDashboardValue(storageKeys.productIncreases, nextIncreases);
      setIncreases(nextIncreases);
      setEditingIds(current => current.filter(id => id !== row.id));
      setErrors(current => ({ ...current, [row.id]: '' }));
      setNotice(storageMode === 'sqlite' ? `Saved locally only for ${row.description}; Supabase is unavailable, so other accounts will not see this update yet.` : `Company amount saved for ${row.description}`);
    } catch (cause) {
      setErrors(current => ({ ...current, [row.id]: cause instanceof Error ? `${cause.message} The entry was preserved for recovery.` : 'Could not save the company amount.' }));
    }
  };
  const unlockRow = (row: CurrencyRow) => {
    setEditingIds(current => current.includes(row.id) ? current : [...current, row.id]);
    setDrafts(current => ({ ...current, [row.id]: String(increaseMap.get(row.id)?.increaseInr ?? '') }));
    setNotice(`Company amount unlocked for ${row.description}`);
  };
  const getCompanyAmount = (row: CurrencyRow, saved: ProductIncrease | undefined, editing: boolean) => {
    if (!editing) return saved?.increaseInr;
    const draft = drafts[row.id];
    if (draft === undefined || draft.trim() === '') return undefined;
    const value = Number(draft);
    return Number.isFinite(value) ? value : undefined;
  };
  const shareProductOnWhatsApp = async (row: CurrencyRow, sellingPrice: number) => {
    if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) { setNotice('Save a valid selling price before sharing this product.'); return; }
    const available = row.active && Math.max(0, row.productCount - (soldMap.get(row.id) ?? 0)) > 0;
    const description = row.description.trim().replace(/\s+/g, ' ').slice(0, 180);
    const message = [
      `📢 *${available ? 'PRODUCT AVAILABLE!' : 'PRODUCT OUT OF STOCK'}*`, '',
      `✨ *Product Name:* ${row.category || 'Product'}`, '',
      `📝 *Description:* ${description}`, '',
      `💰 *Price:* ${formatMoney(sellingPrice)}`, '',
      `📦 *Availability:* ${available ? 'In Stock' : 'Out of Stock'}`,
      `🚚 *Delivery:* ${available ? 'Available' : 'Not Available'}`, '',
      '📞 *For Orders:* DM US', '',
      '📸 Product images attached.', '',
      '*EllextStore*',
    ].join('\n');
    try {
      await shareProductWithImage({ image: row.image, filename: row.category || row.description, text: message });
      setNotice('Product image and details were shared. Choose WhatsApp, then a chat or Status.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setNotice(error instanceof Error ? error.message : 'Could not share the product image and details.');
    }
  };

  return <main className="page-shell">
    <div className="dashboard currency-dashboard percentage-dashboard">
      <aside className="sidebar currency-sidebar">
        <Link href="/" className="brand currency-brand"><BrandLogo /></Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <Link className="nav-link" href="/"><LayoutDashboard size={19} strokeWidth={1.8} /><span>Dashboard</span></Link>
          <Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19} strokeWidth={1.8} /><span>Currency Exchange</span></Link>
          <Link className="nav-link selected" href="/product-percentage"><Percent size={19} strokeWidth={1.8} /><span>Product Percentage</span></Link>
          <Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19} strokeWidth={1.8} /><span>Selling Details</span></Link>
          <Link className="nav-link" href="/ellext-retailers"><Store size={19} strokeWidth={1.8} /><span>Retailers</span></Link>
          <Link className="nav-link" href="/expense-ledger"><ReceiptText size={19} strokeWidth={1.8} /><span>Expense Ledger</span></Link>
        </nav>
        <div className="currency-sidebar-note"><span className="currency-rate-icon"><Percent size={18} /></span><span>Markup entries<br /><b>{increases.length} saved</b></span></div>
        <button className="logout currency-logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </aside>

      <section className="main-panel currency-main percentage-main">
        <header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/product-percentage" /><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · PRICING</span><h1>Product Percentage</h1><p>Set the company selling amount for each product.</p></div></header>
        <div className="percentage-rate-note"><span className="rate-dot live" /><span>{rate ? `INR purchase values use 1 USD = ${rate.usdToInr.toFixed(4)} INR` : 'INR exchange rate has not been loaded yet'}</span><Link href="/currency-exchange">Manage currency exchange <ArrowLeftRight size={13} /></Link></div>
        <div className="currency-table-heading"><div><h2>Product pricing rows</h2><p>{rows.length} active product {rows.length === 1 ? 'row' : 'rows'} from Currency Exchange</p></div></div>
        {rows.length > 0 ? <><div className="currency-table-wrap percentage-table-wrap percentage-desktop-table"><table className="currency-table percentage-table"><thead><tr><th>Date</th><th>Image</th><th>Description</th><th>INR buy value</th><th>Company amount</th><th>Selling price (auto)</th><th>Increase share (of 100%)</th><th>Actions</th></tr></thead>
          <tbody>{rows.map(row => {
            const buyInr = rate ? row.usd * rate.usdToInr : null;
            const saved = increaseMap.get(row.id);
            const editing = editingIds.includes(row.id) || !saved;
            const companyAmount = getCompanyAmount(row, saved, editing);
            const belowCost = buyInr !== null && companyAmount !== undefined && companyAmount < buyInr;
            const percentage = buyInr !== null && companyAmount !== undefined && companyAmount > 0 ? belowCost ? 0 : (companyAmount - buyInr) / companyAmount * 100 : null;
            return <tr key={row.id}>
              <td className="currency-date">{formatDate(row.date)}</td>
              <td><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button></td>
              <td className="currency-description" title={row.description}><span>{row.description}</span></td>
              <td className="currency-money">{buyInr === null ? '—' : formatMoney(buyInr)}</td>
              <td>{editing ? <div className="increase-editor"><label className="visually-hidden" htmlFor={`increase-${row.id}`}>Company selling amount in INR for {row.description}</label><span>₹</span><input id={`increase-${row.id}`} type="number" min="0" step="0.01" value={drafts[row.id] ?? ''} onChange={event => { setDrafts(current => ({ ...current, [row.id]: event.target.value })); setErrors(current => ({ ...current, [row.id]: '' })); }} placeholder="0.00" /><button className="increase-save" onClick={() => saveIncrease(row)} aria-label={`Save and lock company amount for ${row.description}`} title="Save and lock"><Check size={15} /></button>{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div> : <span className="currency-money increase-value">{formatMoney(companyAmount ?? 0)}</span>}</td>
              <td className="currency-money">{companyAmount === undefined ? <span className="percentage-empty">Set company amount</span> : formatMoney(companyAmount)}</td>
              <td>{percentage === null ? <span className="percentage-empty">Set an amount</span> : <div className="percentage-display" title="(Selling price − INR buy value) ÷ selling price × 100"><span className={`percentage-value ${belowCost ? 'percentage-loss' : ''}`}>{belowCost ? 'Below cost' : `${percentage.toFixed(2)}%`}</span>{!belowCost && <span className="percentage-track" aria-hidden="true"><i style={{ width: `${percentage}%` }} /></span>}</div>}</td>
              <td><div className="currency-row-actions"><button className="share-row" disabled={companyAmount === undefined || companyAmount <= 0} onClick={() => companyAmount !== undefined && shareProductOnWhatsApp(row, companyAmount)} aria-label={`Share ${row.description} on WhatsApp`} title={companyAmount === undefined || companyAmount <= 0 ? 'Save a selling price before sharing' : 'Share on WhatsApp'}><Share2 size={15} /></button>{saved && !editing ? <button onClick={() => unlockRow(row)} aria-label={`Unlock increase for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button> : <button onClick={() => beginEdit(row)} aria-label={`Edit increase for ${row.description}`} title="Edit increase"><Pencil size={15} /></button>}{saved && !editing && <span className="locked-indicator" title="Increase is locked"><LockKeyhole size={13} /></span>}</div></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="percentage-mobile-list">{rows.map(row => {
          const buyInr = rate ? row.usd * rate.usdToInr : null;
          const saved = increaseMap.get(row.id);
          const editing = editingIds.includes(row.id) || !saved;
          const companyAmount = getCompanyAmount(row, saved, editing);
          const belowCost = buyInr !== null && companyAmount !== undefined && companyAmount < buyInr;
          const percentage = buyInr !== null && companyAmount !== undefined && companyAmount > 0 ? belowCost ? 0 : (companyAmount - buyInr) / companyAmount * 100 : null;
          return <article className="percentage-mobile-card" key={row.id}>
            <div className="percentage-mobile-card-head"><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button><div><span className="percentage-mobile-date">{formatDate(row.date)}</span><b>{row.description}</b></div></div>
            <div className="percentage-mobile-stats"><div><span>INR buy</span><b>{buyInr === null ? '—' : formatMoney(buyInr)}</b></div><div><span>Company amount</span>{editing ? <div className="increase-editor"><label className="visually-hidden" htmlFor={`mobile-increase-${row.id}`}>Company selling amount in INR for {row.description}</label><span>₹</span><input id={`mobile-increase-${row.id}`} type="number" min="0" step="0.01" value={drafts[row.id] ?? ''} onChange={event => { setDrafts(current => ({ ...current, [row.id]: event.target.value })); setErrors(current => ({ ...current, [row.id]: '' })); }} placeholder="0.00" /><button className="increase-save" onClick={() => saveIncrease(row)} aria-label={`Save and lock company amount for ${row.description}`} title="Save and lock"><Check size={15} /></button>{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div> : <b>{formatMoney(companyAmount ?? 0)}</b>}</div><div><span>Selling price (auto)</span><b>{companyAmount === undefined ? '—' : formatMoney(companyAmount)}</b></div><div><span>Company increase</span><b>{companyAmount === undefined || buyInr === null ? '—' : formatMoney(companyAmount - buyInr)}</b></div></div>
            <div className="percentage-mobile-card-foot"><span>{percentage === null ? 'Set a company amount to see percentage' : belowCost ? 'Below buy cost' : `Increase share ${percentage.toFixed(2)}%`}</span><div className="currency-row-actions"><button className="share-row" disabled={companyAmount === undefined || companyAmount <= 0} onClick={() => companyAmount !== undefined && shareProductOnWhatsApp(row, companyAmount)} aria-label={`Share ${row.description} on WhatsApp`} title={companyAmount === undefined || companyAmount <= 0 ? 'Save a selling price before sharing' : 'Share on WhatsApp'}><Share2 size={15} /></button>{saved && !editing ? <button onClick={() => unlockRow(row)} aria-label={`Unlock company amount for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button> : <button onClick={() => beginEdit(row)} aria-label={`Edit company amount for ${row.description}`} title="Edit amount"><Pencil size={15} /></button>}{saved && !editing && <span className="locked-indicator" title="Company amount is locked"><LockKeyhole size={13} /></span>}</div></div>
          </article>;
        })}</div></> : <div className="currency-empty percentage-empty-state"><span className="currency-empty-icon"><Percent size={20} /></span><strong>No product rows to price</strong><p>Add active product rows in Currency Exchange. Each row will appear here with its own INR buying value.</p><Link href="/currency-exchange" className="currency-empty-link"><ArrowLeftRight size={15} /> Go to Currency Exchange</Link></div>}
        <footer className="currency-source"><span className="rate-dot" />Selling price equals the saved company amount. Company increase = selling price − INR buy value. Increase share = company increase ÷ selling price × 100.</footer>
      </section>
    </div>
    {preview && <div className="modal-scrim image-preview-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><section className="image-preview-card" role="dialog" aria-modal="true" aria-label={`${preview.description} image preview`}><button className="modal-close image-preview-close" onClick={() => setPreview(null)} aria-label="Close image preview"><span aria-hidden>×</span></button><Image src={preview.image} alt={preview.description} fill sizes="(max-width: 700px) 90vw, 640px" unoptimized /><p>{preview.description}</p></section></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><span aria-hidden>×</span></button></div>}
  </main>;
}
