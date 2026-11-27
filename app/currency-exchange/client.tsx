'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeftRight, Archive, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LogOut, Pencil, Percent, Plus, ReceiptText, Store, Trash2, Upload, X } from 'lucide-react';
import { defaultProductCategories, isStoredCurrencyRate, isStoredCurrencyRows, isStoredSellingEntries, storageKeys, type CurrencyRateSnapshot, type CurrencyRow } from '../../lib/storage';
import { MobileFinanceNav } from '../../components/mobile-finance-nav';
import { loadSharedDashboardValue, saveSharedDashboardValue } from '../../lib/shared-dashboard';
import { fetchWithDataLoading } from '@/lib/data-fetch';

type ExchangeApiResponse = { result?: string; base_code?: string; rates?: { INR?: number }; time_last_update_utc?: string };

const formatMoney = (amount: number, currency: 'USD' | 'INR') => new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'en-IN', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 2 }).format(amount);
const formatDate = (date: string) => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export default function CurrencyExchangePage() {
  const [rows, setRows] = useState<CurrencyRow[]>([]);
  const [rate, setRate] = useState<CurrencyRateSnapshot | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [rateStatus, setRateStatus] = useState<'loading' | 'live' | 'cached' | 'unavailable'>('loading');
  const [rateError, setRateError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [preview, setPreview] = useState<CurrencyRow | null>(null);
  const [description, setDescription] = useState('');
  const [usd, setUsd] = useState('');
  const [productCount, setProductCount] = useState('1');
  const [category, setCategory] = useState('Ring');
  const [categories, setCategories] = useState<string[]>(defaultProductCategories);
  const [newCategory, setNewCategory] = useState('');
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [soldById, setSoldById] = useState<Record<string, number>>({});
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingRow, setSavingRow] = useState(false);
  const saveRowInFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cachedRate = useRef<CurrencyRateSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const load = async <T,>(key: typeof storageKeys.currencyRows | typeof storageKeys.currencyRate | typeof storageKeys.sellingEntries | typeof storageKeys.productCategories, validate: (value: unknown) => value is T, fallback: T): Promise<T> => {
      try { return await loadSharedDashboardValue(key, validate) ?? fallback; }
      catch { if (active) setNotice('Shared company data is unavailable. Device data was preserved for recovery; reconnect before editing shared records.'); return fallback; }
    };
    void (async () => {
      const [savedRows, savedCategories, selling, savedRate] = await Promise.all([
        load(storageKeys.currencyRows, isStoredCurrencyRows, [] as CurrencyRow[]),
        load(storageKeys.productCategories, (value): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string'), [] as string[]),
        load(storageKeys.sellingEntries, isStoredSellingEntries, []),
        load(storageKeys.currencyRate, isStoredCurrencyRate, null),
      ]);
      if (!active) return;
      setRows(savedRows);
      setCategories([...defaultProductCategories, ...savedCategories.filter(item => !defaultProductCategories.includes(item))]);
      setSoldById(Object.fromEntries(selling.map(item => [item.sourceId, item.soldCount])));
      if (savedRate) { setRate(savedRate); cachedRate.current = savedRate; }
      setHydrated(true);
    })();
    return () => { active = false; };
  }, []);

  const refreshRate = useCallback(async () => {
    setRateStatus('loading');
    setRateError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetchWithDataLoading('/api/exchange-rate', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Exchange rate request failed: ${response.status}`);
      const data = await response.json() as ExchangeApiResponse;
      if (data.result !== 'success' || data.base_code !== 'USD' || !data.rates?.INR || !Number.isFinite(data.rates.INR)) throw new Error('Exchange rate response was invalid');
      const snapshot = { usdToInr: data.rates.INR, updatedAt: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString() : new Date().toISOString() };
      const storageMode = await saveSharedDashboardValue(storageKeys.currencyRate, snapshot);
      setRate(snapshot);
      cachedRate.current = snapshot;
      setRateStatus('live');
      if (storageMode === 'sqlite') setNotice('Exchange rate saved locally; Supabase is unavailable, so other accounts will not see this update yet.');
    } catch (cause) {
      setRateError(cause instanceof DOMException && cause.name === 'AbortError' ? 'Rate request timed out after 4 seconds.' : cause instanceof Error ? cause.message : 'Could not load the exchange rate');
      setRateStatus(cachedRate.current ? 'cached' : 'unavailable');
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const cached = cachedRate.current;
    if (cached && Date.now() - Date.parse(cached.updatedAt) < 24 * 60 * 60 * 1000) setRateStatus('cached');
    else void refreshRate();
    const interval = window.setInterval(() => void refreshRate(), 24 * 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [hydrated, refreshRate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setModalOpen(false); setPreview(null); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visibleRows = useMemo(() => rows.filter(row => showArchived ? !row.active : row.active), [rows, showArchived]);
  const activeRows = useMemo(() => rows.filter(row => row.active), [rows]);
  const totals = useMemo(() => activeRows.reduce((total, row) => ({ usd: total.usd + row.usd, count: total.count + row.productCount }), { usd: 0, count: 0 }), [activeRows]);
  const inrTotal = rate ? totals.usd * rate.usdToInr : null;
  const totalStockValue = rate ? activeRows.reduce((total, row) => total + row.usd * rate.usdToInr * row.productCount, 0) : null;
  const resetForm = () => { setDescription(''); setUsd(''); setProductCount('1'); setCategory(categories[0] ?? 'Ring'); setImage(''); setImageName(''); setError(''); setEditingId(null); };
  const openAdd = () => { resetForm(); setModalOpen(true); };
  const openEdit = (row: CurrencyRow) => { setEditingId(row.id); setDescription(row.description); setUsd(String(row.usd)); setProductCount(String(row.productCount)); setCategory(row.category ?? categories[0] ?? 'Ring'); setImage(row.image); setImageName(row.image.startsWith('data:') ? 'Saved image' : 'Current image'); setError(''); setModalOpen(true); };
  const loadImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be 5 MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') { setError('The selected image could not be read.'); return; }
      const source = new window.Image();
      source.onload = () => {
        const scale = Math.min(1, 900 / Math.max(source.naturalWidth, source.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { setError('This image could not be prepared for storage.'); return; }
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        setImage(canvas.toDataURL('image/jpeg', 0.9));
        setImageName(file.name);
        setError('');
      };
      source.onerror = () => setError('This image format could not be previewed. Choose a JPG, PNG, or WebP image.');
      source.src = reader.result;
    };
    reader.onerror = () => setError('The selected image could not be read.');
    reader.readAsDataURL(file);
  };
  const saveRow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveRowInFlight.current) return;
    if (description.trim().length < 2) { setError('Add a description with at least 2 characters.'); return; }
    const usdAmount = Number(usd), count = Number(productCount);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) { setError('Enter a USD amount greater than 0.'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 999999) { setError('Enter a product count from 1 to 999,999.'); return; }
    if (!image) { setError('Add an image to continue.'); return; }
    const nextRows = editingId
      ? rows.map(row => row.id === editingId ? { ...row, description: description.trim(), usd: usdAmount, productCount: count, image, category } : row)
      : [...rows, { id: crypto.randomUUID(), date: new Date().toISOString(), image, description: description.trim(), usd: usdAmount, productCount: count, active: true, category }];
    saveRowInFlight.current = true;
    setSavingRow(true);
    try {
      const storageMode = await saveSharedDashboardValue(storageKeys.currencyRows, nextRows);
      setRows(nextRows); setNotice(storageMode === 'sqlite' ? 'Saved locally only. Supabase is unavailable; other accounts will not see this row yet.' : editingId ? 'Exchange row updated' : 'Exchange row added'); setModalOpen(false); resetForm();
    } catch (cause) { setError(cause instanceof Error ? `${cause.message} The draft was preserved for recovery.` : 'Could not save the exchange row. The draft was preserved for recovery.'); }
    finally { saveRowInFlight.current = false; setSavingRow(false); }
  };
  const deleteRow = async (id: string) => { const nextRows = rows.filter(row => row.id !== id); try { const mode = await saveSharedDashboardValue(storageKeys.currencyRows, nextRows); setRows(nextRows); setNotice(mode === 'sqlite' ? 'Deleted locally only; Supabase is unavailable, so the change is not shared.' : 'Exchange row deleted'); } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not delete the exchange row.'); } };
  const archiveRow = async (id: string) => { const nextRows = rows.map(row => row.id === id ? { ...row, active: !row.active } : row); try { const mode = await saveSharedDashboardValue(storageKeys.currencyRows, nextRows); setRows(nextRows); setNotice(mode === 'sqlite' ? 'Updated locally only; Supabase is unavailable, so the change is not shared.' : showArchived ? 'Exchange row restored' : 'Exchange row archived'); } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not update the exchange row.'); } };
  const addCategory = async () => { const next = newCategory.trim(); if (!next) return; if (categories.some(item => item.toLowerCase() === next.toLowerCase())) { setError('That category already exists.'); return; } const nextCategories = [...categories, next]; try { const mode = await saveSharedDashboardValue(storageKeys.productCategories, nextCategories.filter(item => !defaultProductCategories.includes(item))); setCategories(nextCategories); setCategory(next); setNewCategory(''); setCategoryModalOpen(false); setNotice(mode === 'sqlite' ? `Category saved locally only: ${next}` : `Category added: ${next}`); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the category.'); } };
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  return <main className="page-shell">
    <div className="dashboard currency-dashboard">
      <aside className="sidebar currency-sidebar">
        <Link href="/" className="brand currency-brand"><BrandLogo /></Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <Link className="nav-link" href="/"><LayoutDashboard size={19} strokeWidth={1.8} /><span>Dashboard</span></Link>
          <Link className="nav-link selected" href="/currency-exchange"><ArrowLeftRight size={19} strokeWidth={1.8} /><span>Currency Exchange</span></Link>
          <Link className="nav-link" href="/product-percentage"><Percent size={19} strokeWidth={1.8} /><span>Product Percentage</span></Link>
          <Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19} strokeWidth={1.8} /><span>Selling Details</span></Link>
          <Link className="nav-link" href="/ellext-retailers"><Store size={19} strokeWidth={1.8} /><span>Retailers</span></Link>
          <Link className="nav-link" href="/expense-ledger"><ReceiptText size={19} strokeWidth={1.8} /><span>Expense Ledger</span></Link>
        </nav>
        <div className="currency-sidebar-note"><span className="currency-rate-icon"><ArrowLeftRight size={18} /></span><span>Daily USD to INR<br /><b>{rate ? rate.usdToInr.toFixed(2) : 'Loading rate'}</b></span></div>
        <button className="logout currency-logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </aside>
      <section className="main-panel currency-main">
        <header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/currency-exchange" /><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · FINANCE</span><h1>Currency Exchange</h1><p>Track product purchases in USD and their INR value.</p></div><button className="currency-add" onClick={openAdd}><Plus size={18} /> Add row</button></header>
        <div className="currency-summary">
          <article><span>USD BUY VALUE</span><strong>{formatMoney(totals.usd, 'USD')}</strong><small>{totals.count.toLocaleString('en-IN')} products across active rows</small></article>
          <article><span>INR EXCHANGE VALUE</span><strong>{inrTotal === null ? '—' : formatMoney(inrTotal, 'INR')}</strong><small>Converted using the current USD to INR rate</small></article>
          <article className="rate-summary"><span>USD → INR RATE</span><strong>{rate ? rate.usdToInr.toFixed(4) : rateStatus === 'loading' ? 'Loading…' : 'Unavailable'}</strong><small>{rate ? `${rateStatus === 'cached' ? 'Last saved' : 'Rate updated'} ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(rate.updatedAt))}` : rateStatus === 'loading' ? 'Checking daily rate…' : <>{rateError || 'Could not connect to the exchange rate service.'} <button className="rate-retry" onClick={() => void refreshRate()}>Retry</button></>}</small></article>
          <article className="stock-value-summary"><span>TOTAL STOCK VALUE</span><strong>{totalStockValue === null ? '—' : formatMoney(totalStockValue, 'INR')}</strong><small>INR buy price × quantity across active rows</small></article>
        </div>
        <section className="stock-by-category" aria-label="Live product stock by category"><div><span className="currency-kicker">LIVE STOCK</span><h2>Products available</h2></div><div className="stock-category-list">{categories.map(item => { const categoryRows = activeRows.filter(row => (row.category ?? 'Ring') === item); const available = categoryRows.reduce((sum, row) => sum + Math.max(0, row.productCount - (soldById[row.id] ?? 0)), 0); return <article key={item}><span>{item}</span><strong>{available.toLocaleString('en-IN')}</strong><small>{categoryRows.length} {categoryRows.length === 1 ? 'product' : 'products'}</small></article>; })}</div></section>
        {rateStatus === 'unavailable' && <div className="currency-alert" role="status">Live exchange rate is unavailable. Saved rows remain available; conversion updates when a rate can be loaded.</div>}
        <div className="currency-table-heading"><div><h2>Product exchange rows</h2><p>{visibleRows.length} {showArchived ? 'archived' : 'active'} {visibleRows.length === 1 ? 'row' : 'rows'}</p></div><button className={`archive-toggle ${showArchived ? 'archive-selected' : ''}`} onClick={() => setShowArchived(current => !current)}><Archive size={16} />{showArchived ? 'Show active' : 'Archived'} <span>{rows.filter(row => !row.active).length}</span></button></div>
        <div className="currency-table-wrap"><table className="currency-table"><thead><tr><th>Date</th><th>Image</th><th>Category</th><th>Description</th><th>USD buy value</th><th>INR buy value</th><th>Product count</th><th>Actions</th></tr></thead>
          <tbody>{visibleRows.map(row => <tr key={row.id} className={!row.active ? 'currency-row-archived' : ''}><td className="currency-date">{formatDate(row.date)}</td><td><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview image for ${row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button></td><td><span className="product-count-pill">{row.category ?? 'Ring'}</span></td><td className="currency-description" title={row.description}><span>{row.description}</span></td><td className="currency-money">{formatMoney(row.usd, 'USD')}</td><td className="currency-money">{rate ? formatMoney(row.usd * rate.usdToInr, 'INR') : '—'}</td><td><span className="product-count-pill">{Math.max(0, row.productCount - (soldById[row.id] ?? 0)).toLocaleString('en-IN')} / {row.productCount.toLocaleString('en-IN')}</span></td><td><div className="currency-row-actions"><button onClick={() => openEdit(row)} aria-label={`Edit ${row.description}`} title="Edit row"><Pencil size={15} /></button><button onClick={() => archiveRow(row.id)} aria-label={row.active ? `Archive ${row.description}` : `Restore ${row.description}`} title={row.active ? 'Archive row' : 'Restore row'}><Archive size={15} /></button><button className="delete-row" onClick={() => deleteRow(row.id)} aria-label={`Delete ${row.description}`} title="Delete row"><Trash2 size={15} /></button></div></td></tr>)}</tbody>
        </table>
        {visibleRows.length === 0 && <div className="currency-empty"><span className="currency-empty-icon"><ArrowLeftRight size={20} /></span><strong>{showArchived ? 'No archived rows' : 'No exchange rows yet'}</strong><p>{showArchived ? 'Archived rows will appear here.' : 'Add your first product purchase to start tracking its USD and INR value.'}</p>{!showArchived && <button onClick={openAdd}><Plus size={16} /> Add first row</button>}</div>}
        </div>
        <section className="currency-total-bar" aria-label="Active totals"><div className="currency-total-title"><span className="currency-total-mark"><Check size={15} /></span><span><b>Active totals</b><small>Across active rows</small></span></div><div className="currency-total-detail"><span>Products</span><b>{totals.count.toLocaleString('en-IN')}</b></div><div className="currency-total-detail"><span>USD buy value</span><b>{formatMoney(totals.usd, 'USD')}</b></div><div className="currency-total-detail"><span>INR exchange value</span><b>{inrTotal === null ? '—' : formatMoney(inrTotal, 'INR')}</b></div><div className="currency-total-detail currency-stock-total"><span>Total stock value</span><b>{totalStockValue === null ? '—' : formatMoney(totalStockValue, 'INR')}</b></div></section>
        <footer className="currency-source"><span className={`rate-dot ${rateStatus}`} />{rate ? `Daily reference rate · 1 USD = ${rate.usdToInr.toFixed(4)} INR · Updated ${formatDate(rate.updatedAt)}` : 'Waiting for a daily USD to INR reference rate'}<a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a></footer>
      </section>
    </div>

    {modalOpen && <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setModalOpen(false); }}><section className="modal-card currency-modal" role="dialog" aria-modal="true" aria-labelledby="currency-modal-title"><div className="modal-heading"><div><span className="currency-kicker">{editingId ? 'UPDATE ENTRY' : 'NEW ENTRY'}</span><h2 id="currency-modal-title">{editingId ? 'Edit exchange row' : 'Add exchange row'}</h2></div><button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close dialog"><X size={18} /></button></div>
      <form className="action-form" onSubmit={saveRow} noValidate><label>Product image <span>(up to 5 MB)</span><button type="button" className="currency-upload" onClick={() => fileRef.current?.click()}>{image ? <span className="upload-preview"><Image src={image} alt="Selected product preview" fill sizes="64px" unoptimized /></span> : <span className="upload-icon"><Upload size={18} /></span>}<span><b>{imageName || 'Choose an image'}</b><small>{image ? 'Click to replace image' : 'JPG, PNG, WebP'}</small></span><Plus size={17} /></button><input ref={fileRef} className="currency-file-input" type="file" accept="image/*" onChange={loadImage} /></label>
        <label>Description<input autoFocus value={description} onChange={event => { setDescription(event.target.value); setError(''); }} placeholder="Product or purchase description" /></label>
        <div className="currency-form-grid"><label>Category<div className="category-select-row"><select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select><button type="button" className="category-add-button" onClick={() => { setNewCategory(''); setError(''); setCategoryModalOpen(true); }} aria-label="Add category" title="Add category"><Plus size={17} /></button></div></label><label>Product count<input type="number" min="1" step="1" value={productCount} onChange={event => { setProductCount(event.target.value); setError(''); }} placeholder="1" /></label><label>USD buy value<input type="number" min="0.01" step="0.01" value={usd} onChange={event => { setUsd(event.target.value); setError(''); }} placeholder="0.00" /></label></div>
        <div className="currency-conversion-preview"><span><ArrowLeftRight size={15} /> Estimated INR value</span><b>{rate && Number(usd) > 0 ? formatMoney(Number(usd) * rate.usdToInr, 'INR') : '—'}</b><small>{rate ? `At 1 USD = ${rate.usdToInr.toFixed(4)} INR` : 'Exchange rate is loading'}</small></div>
        {!rate && <p className="currency-rate-help" role="status">The row can be saved now. INR conversion will appear when the exchange rate is available.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}<button className="form-submit" type="submit" disabled={savingRow}>{savingRow ? 'Saving…' : editingId ? 'Save changes' : 'Add row'}</button>
      </form></section></div>}

    {preview && <div className="modal-scrim image-preview-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><section className="image-preview-card" role="dialog" aria-modal="true" aria-label={`${preview.description} image preview`}><button className="modal-close image-preview-close" onClick={() => setPreview(null)} aria-label="Close image preview"><X size={18} /></button><Image src={preview.image} alt={preview.description} fill sizes="(max-width: 700px) 90vw, 640px" unoptimized /><p>{preview.description}</p></section></div>}
    {categoryModalOpen && <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setCategoryModalOpen(false); }}><section className="modal-card category-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-heading"><div><span className="currency-kicker">PRODUCT SETUP</span><h2 id="category-modal-title">Add category</h2></div><button className="modal-close" onClick={() => setCategoryModalOpen(false)} aria-label="Close category dialog"><X size={18} /></button></div><form className="action-form" onSubmit={event => { event.preventDefault(); addCategory(); }}><label>Category name<input autoFocus value={newCategory} onChange={event => { setNewCategory(event.target.value); setError(''); }} placeholder="e.g. Pendant" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="form-submit" type="submit">Add category</button></form></section></div>}
    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
  </main>;
}
