'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LockKeyhole, LogOut, Pencil, Percent, UnlockKeyhole } from 'lucide-react';
import { isStoredCurrencyRate, isStoredCurrencyRows, isStoredProductIncreases, readVersioned, storageKeys, writeVersioned, type CurrencyRateSnapshot, type CurrencyRow, type ProductIncrease } from '../../lib/storage';

const formatMoney = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export default function ProductPercentagePage() {
  const [sourceRows, setSourceRows] = useState<CurrencyRow[]>([]);
  const [rate, setRate] = useState<CurrencyRateSnapshot | null>(null);
  const [increases, setIncreases] = useState<ProductIncrease[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [preview, setPreview] = useState<CurrencyRow | null>(null);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const signOut = async () => { await fetch('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  useEffect(() => {
    setSourceRows(readVersioned(storageKeys.currencyRows, isStoredCurrencyRows) ?? []);
    setRate(readVersioned(storageKeys.currencyRate, isStoredCurrencyRate));
    setIncreases(readVersioned(storageKeys.productIncreases, isStoredProductIncreases) ?? []);
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) writeVersioned(storageKeys.productIncreases, increases); }, [hydrated, increases]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const rows = useMemo(() => sourceRows.filter(row => row.active), [sourceRows]);
  const increaseMap = useMemo(() => new Map(increases.map(item => [item.sourceId, item])), [increases]);
  const beginEdit = (row: CurrencyRow) => {
    const saved = increaseMap.get(row.id);
    setEditingIds(current => current.includes(row.id) ? current : [...current, row.id]);
    setDrafts(current => ({ ...current, [row.id]: saved ? String(saved.increaseInr) : current[row.id] ?? '' }));
    setErrors(current => ({ ...current, [row.id]: '' }));
  };
  const saveIncrease = (row: CurrencyRow) => {
    const value = Number(drafts[row.id]);
    if (drafts[row.id]?.trim() === '' || !Number.isFinite(value) || value < 0) {
      setErrors(current => ({ ...current, [row.id]: 'Enter a valid increase amount.' }));
      return;
    }
    const entry: ProductIncrease = { sourceId: row.id, increaseInr: value, locked: true, updatedAt: new Date().toISOString() };
    setIncreases(current => [...current.filter(item => item.sourceId !== row.id), entry]);
    setEditingIds(current => current.filter(id => id !== row.id));
    setErrors(current => ({ ...current, [row.id]: '' }));
    setNotice(`Increase saved for ${row.description}`);
  };
  const unlockRow = (row: CurrencyRow) => {
    setEditingIds(current => current.includes(row.id) ? current : [...current, row.id]);
    setDrafts(current => ({ ...current, [row.id]: String(increaseMap.get(row.id)?.increaseInr ?? '') }));
    setNotice(`Increase unlocked for ${row.description}`);
  };

  return <main className="page-shell">
    <div className="dashboard currency-dashboard percentage-dashboard">
      <aside className="sidebar currency-sidebar">
        <Link href="/" className="brand currency-brand">Ellext<span>Store</span><i /></Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <Link className="nav-link" href="/"><LayoutDashboard size={19} strokeWidth={1.8} /><span>Dashboard</span></Link>
          <Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19} strokeWidth={1.8} /><span>Currency Exchange</span></Link>
          <Link className="nav-link selected" href="/product-percentage"><Percent size={19} strokeWidth={1.8} /><span>Product Percentage</span></Link>
          <Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19} strokeWidth={1.8} /><span>Selling Details</span></Link>
        </nav>
        <div className="currency-sidebar-note"><span className="currency-rate-icon"><Percent size={18} /></span><span>Markup entries<br /><b>{increases.length} saved</b></span></div>
        <button className="logout currency-logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </aside>

      <section className="main-panel currency-main percentage-main">
        <header className="currency-header"><div><Link href="/" className="currency-mobile-home">Ellext<span>Store</span></Link><span className="currency-kicker">ELLEXTSTORE · PRICING</span><h1>Product Percentage</h1><p>Set a company increase for each product’s INR buying value.</p></div></header>
        <div className="percentage-rate-note"><span className="rate-dot live" /><span>{rate ? `INR purchase values use 1 USD = ${rate.usdToInr.toFixed(4)} INR` : 'INR exchange rate has not been loaded yet'}</span><Link href="/currency-exchange">Manage currency exchange <ArrowLeftRight size={13} /></Link></div>
        <div className="currency-table-heading"><div><h2>Product markup rows</h2><p>{rows.length} active product {rows.length === 1 ? 'row' : 'rows'} from Currency Exchange</p></div></div>
        {rows.length > 0 ? <><div className="currency-table-wrap percentage-table-wrap percentage-desktop-table"><table className="currency-table percentage-table"><thead><tr><th>Date</th><th>Image</th><th>Description</th><th>INR buy value</th><th>Company increase</th><th>Increase share (of 100%)</th><th>Actions</th></tr></thead>
          <tbody>{rows.map(row => {
            const buyInr = rate ? row.usd * rate.usdToInr : null;
            const saved = increaseMap.get(row.id);
            const editing = editingIds.includes(row.id) || !saved;
            const increase = saved?.increaseInr;
            const percentage = buyInr !== null && increase !== undefined ? increase / (buyInr + increase) * 100 : null;
            return <tr key={row.id}>
              <td className="currency-date">{formatDate(row.date)}</td>
              <td><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button></td>
              <td className="currency-description" title={row.description}><span>{row.description}</span></td>
              <td className="currency-money">{buyInr === null ? '—' : formatMoney(buyInr)}</td>
              <td>{editing ? <div className="increase-editor"><label className="visually-hidden" htmlFor={`increase-${row.id}`}>Company increase in INR for {row.description}</label><span>₹</span><input id={`increase-${row.id}`} type="number" min="0" step="0.01" value={drafts[row.id] ?? ''} onChange={event => { setDrafts(current => ({ ...current, [row.id]: event.target.value })); setErrors(current => ({ ...current, [row.id]: '' })); }} placeholder="0.00" /><button className="increase-save" onClick={() => saveIncrease(row)} aria-label={`Save and lock increase for ${row.description}`} title="Save and lock"><Check size={15} /></button>{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div> : <span className="currency-money increase-value">{formatMoney(increase ?? 0)}</span>}</td>
              <td>{percentage === null ? <span className="percentage-empty">Set an increase</span> : <div className="percentage-display" title="Company increase ÷ final price (INR buy value + company increase)"><span className="percentage-value">{percentage.toFixed(2)}%</span><span className="percentage-track" aria-hidden="true"><i style={{ width: `${percentage}%` }} /></span></div>}</td>
              <td><div className="currency-row-actions">{saved && !editing ? <button onClick={() => unlockRow(row)} aria-label={`Unlock increase for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button> : <button onClick={() => beginEdit(row)} aria-label={`Edit increase for ${row.description}`} title="Edit increase"><Pencil size={15} /></button>}{saved && !editing && <span className="locked-indicator" title="Increase is locked"><LockKeyhole size={13} /></span>}</div></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="percentage-mobile-list">{rows.map(row => {
          const buyInr = rate ? row.usd * rate.usdToInr : null;
          const saved = increaseMap.get(row.id);
          const editing = editingIds.includes(row.id) || !saved;
          const increase = saved?.increaseInr;
          const percentage = buyInr !== null && increase !== undefined ? increase / (buyInr + increase) * 100 : null;
          return <article className="percentage-mobile-card" key={row.id}>
            <div className="percentage-mobile-card-head"><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button><div><span className="percentage-mobile-date">{formatDate(row.date)}</span><b>{row.description}</b></div></div>
            <div className="percentage-mobile-stats"><div><span>INR buy</span><b>{buyInr === null ? '—' : formatMoney(buyInr)}</b></div><div><span>Company increase</span>{editing ? <div className="increase-editor"><label className="visually-hidden" htmlFor={`mobile-increase-${row.id}`}>Company increase in INR for {row.description}</label><span>₹</span><input id={`mobile-increase-${row.id}`} type="number" min="0" step="0.01" value={drafts[row.id] ?? ''} onChange={event => { setDrafts(current => ({ ...current, [row.id]: event.target.value })); setErrors(current => ({ ...current, [row.id]: '' })); }} placeholder="0.00" /><button className="increase-save" onClick={() => saveIncrease(row)} aria-label={`Save and lock increase for ${row.description}`} title="Save and lock"><Check size={15} /></button>{errors[row.id] && <small className="increase-error" role="alert">{errors[row.id]}</small>}</div> : <b>{formatMoney(increase ?? 0)}</b>}</div></div>
            <div className="percentage-mobile-card-foot"><span>{percentage === null ? 'Set an increase to see percentage' : `Increase share ${percentage.toFixed(2)}%`}</span><div className="currency-row-actions">{saved && !editing ? <button onClick={() => unlockRow(row)} aria-label={`Unlock increase for ${row.description}`} title="Unlock to edit"><UnlockKeyhole size={15} /></button> : <button onClick={() => beginEdit(row)} aria-label={`Edit increase for ${row.description}`} title="Edit increase"><Pencil size={15} /></button>}{saved && !editing && <span className="locked-indicator" title="Increase is locked"><LockKeyhole size={13} /></span>}</div></div>
          </article>;
        })}</div></> : <div className="currency-empty percentage-empty-state"><span className="currency-empty-icon"><Percent size={20} /></span><strong>No product rows to price</strong><p>Add active product rows in Currency Exchange. Each row will appear here with its own INR buying value.</p><Link href="/currency-exchange" className="currency-empty-link"><ArrowLeftRight size={15} /> Go to Currency Exchange</Link></div>}
        <footer className="currency-source"><span className="rate-dot" />Increase share = company increase ÷ (INR buy value + company increase) × 100. It stays within 0–100% of the final price.</footer>
      </section>
    </div>
    {preview && <div className="modal-scrim image-preview-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><section className="image-preview-card" role="dialog" aria-modal="true" aria-label={`${preview.description} image preview`}><button className="modal-close image-preview-close" onClick={() => setPreview(null)} aria-label="Close image preview"><span aria-hidden>×</span></button><Image src={preview.image} alt={preview.description} fill sizes="(max-width: 700px) 90vw, 640px" unoptimized /><p>{preview.description}</p></section></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><span aria-hidden>×</span></button></div>}
  </main>;
}
