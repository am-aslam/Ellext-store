'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, Image as ImageIcon, LayoutDashboard, LockKeyhole, LogOut, Percent, Pencil, ReceiptText, Share2, Store, UnlockKeyhole } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { MobileFinanceNav } from '@/components/mobile-finance-nav';
import { isStoredCurrencyRows, isStoredSellingEntries, storageKeys, type CurrencyRow, type SellingEntry } from '@/lib/storage';
import { loadSharedDashboardValues, saveSharedDashboardValue } from '@/lib/shared-dashboard';
import { shareProductWithImage } from '@/lib/product-share';
import { fetchWithDataLoading } from '@/lib/data-fetch';

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
type Draft = { amount: string; sold: string };

export default function EllextRetailersClient() {
  const [products, setProducts] = useState<CurrencyRow[]>([]);
  const [entries, setEntries] = useState<SellingEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<CurrencyRow | null>(null);
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [editingAmount, setEditingAmount] = useState<string[]>([]);
  const [editingSold, setEditingSold] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [hasLoadedSharedData, setHasLoadedSharedData] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8500);
    setLoading(true);
    setLoadError('');
    void loadSharedDashboardValues({
      [storageKeys.currencyRows]: isStoredCurrencyRows,
      [storageKeys.sellingEntries]: isStoredSellingEntries,
    }, controller.signal, reload).then(snapshots => {
      if (!active) return;
      const productSnapshot: unknown = snapshots[storageKeys.currencyRows];
      const entrySnapshot: unknown = snapshots[storageKeys.sellingEntries];
      const savedProducts: CurrencyRow[] = isStoredCurrencyRows(productSnapshot) ? productSnapshot : [];
      const savedEntries: SellingEntry[] = isStoredSellingEntries(entrySnapshot) ? entrySnapshot : [];
      const productRows = savedProducts ?? [];
      const sales = savedEntries ?? [];
      setProducts(productRows);
      setEntries(sales);
      setHasLoadedSharedData(true);
      setDrafts(Object.fromEntries(productRows.map(row => {
        const saved = sales.find(entry => entry.sourceId === row.id);
        return [row.id, { amount: saved?.retailerAmountInr === undefined ? '' : String(saved.retailerAmountInr), sold: saved?.retailerSoldCount === undefined ? '' : String(saved.retailerSoldCount) }];
      })));
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? `Shared data could not be loaded: ${error.name === 'AbortError' ? 'the server did not respond within 8.5 seconds.' : error.message}` : 'Shared data could not be loaded.');
    }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [reload]);

  const rows = useMemo(() => products.filter(row => row.active), [products]);
  const entryMap = useMemo(() => new Map(entries.map(entry => [entry.sourceId, entry])), [entries]);
  const totals = useMemo(() => rows.reduce((sum, row) => {
    const entry = entryMap.get(row.id);
    const count = entry?.retailerSoldCount ?? 0;
    const amount = entry?.retailerAmountInr ?? 0;
    return { count: sum.count + count, collected: sum.collected + count * amount };
  }, { count: 0, collected: 0 }), [rows, entryMap]);

  const saveRetailerField = async (row: CurrencyRow, field: 'amount' | 'sold') => {
    const draft = drafts[row.id] ?? { amount: '', sold: '0' };
    const amount = Number(draft.amount);
    const soldCount = Number(draft.sold);
    const previous = entryMap.get(row.id);
    const directSold = previous?.soldCount ?? 0;
    const available = Math.max(0, row.productCount - directSold);
    if (field === 'amount' && (draft.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0)) {
      setErrors(current => ({ ...current, [`${row.id}:amount`]: 'Enter a retailer amount greater than zero.' })); return;
    }
    if (field === 'sold' && (draft.sold.trim() === '' || !Number.isInteger(soldCount) || soldCount < 0 || soldCount > available)) {
      setErrors(current => ({ ...current, [`${row.id}:sold`]: `Enter a sold count from 0 to ${available}.` })); return;
    }
    const now = new Date().toISOString();
    const updated: SellingEntry = { ...previous, sourceId: row.id, soldCount: directSold, ...(field === 'amount' ? { retailerAmountInr: amount } : { retailerSoldCount: soldCount }), retailerUpdatedAt: now, updatedAt: previous?.updatedAt ?? now };
    const next = [...entries.filter(entry => entry.sourceId !== row.id), updated];
    const saveKey = `${row.id}:${field}`;
    setSavingId(saveKey);
    try {
      const mode = await saveSharedDashboardValue(storageKeys.sellingEntries, next);
      setEntries(next);
      setErrors(current => ({ ...current, [saveKey]: '' }));
      if (field === 'amount') setEditingAmount(current => current.filter(id => id !== row.id));
      else setEditingSold(current => current.filter(id => id !== row.id));
      setNotice(mode === 'supabase' ? `Retailer ${field === 'amount' ? 'amount' : 'sold count'} saved and locked for ${row.category || row.description}.` : 'Saved on this device only; Supabase is unavailable, so other accounts will not see this update.');
    } catch (error) {
      setErrors(current => ({ ...current, [saveKey]: error instanceof Error ? error.message : 'Could not save retailer details.' }));
    } finally { setSavingId(''); }
  };
  const toggleRetailerEdit = (row: CurrencyRow, field: 'amount' | 'sold') => {
    const setEditing = field === 'amount' ? setEditingAmount : setEditingSold;
    const editing = field === 'amount' ? editingAmount : editingSold;
    const savedValue = field === 'amount' ? entryMap.get(row.id)?.retailerAmountInr : entryMap.get(row.id)?.retailerSoldCount;
    if (editing.includes(row.id)) {
      setEditing(current => current.filter(id => id !== row.id));
      setDrafts(current => ({ ...current, [row.id]: { ...(current[row.id] ?? { amount: '', sold: '' }), [field]: savedValue === undefined ? '' : String(savedValue) } }));
      return;
    }
    setEditing(current => [...current, row.id]);
    setDrafts(current => ({ ...current, [row.id]: { ...(current[row.id] ?? { amount: '', sold: '' }), [field]: savedValue === undefined ? '' : String(savedValue) } }));
  };
  const saveRetailer = async (row: CurrencyRow) => {
    const draft = drafts[row.id] ?? { amount: '', sold: '' };
    const amount = Number(draft.amount); const soldCount = Number(draft.sold);
    const previous = entryMap.get(row.id); const limit = Math.max(0, row.productCount - (previous?.soldCount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(soldCount) || soldCount < 0 || soldCount > limit) {
      setErrors(current => ({ ...current, [row.id]: `Enter an amount greater than zero and a sold count from 0 to ${limit}.` })); return;
    }
    const now = new Date().toISOString();
    const updated: SellingEntry = { ...previous, sourceId: row.id, soldCount: previous?.soldCount ?? 0, retailerAmountInr: amount, retailerSoldCount: soldCount, retailerUpdatedAt: now, updatedAt: previous?.updatedAt ?? now };
    const next = [...entries.filter(entry => entry.sourceId !== row.id), updated];
    setSavingId(row.id);
    try {
      const mode = await saveSharedDashboardValue(storageKeys.sellingEntries, next);
      setEntries(next); setErrors(current => ({ ...current, [row.id]: '' }));
      setNotice(mode === 'supabase' ? `Retailer details saved for ${row.category || row.description}.` : 'Saved on this device only; Supabase is unavailable, so other accounts will not see this update.');
    } catch (error) { setErrors(current => ({ ...current, [row.id]: error instanceof Error ? error.message : 'Could not save retailer details.' })); }
    finally { setSavingId(''); }
  };

  const shareRetailerProduct = async (row: CurrencyRow) => {
    const entry = entryMap.get(row.id);
    const amount = entry?.retailerAmountInr;
    if (!amount || amount <= 0) { setNotice('Save a retailer amount before sharing this product.'); return; }
    const sold = (entry?.soldCount ?? 0) + (entry?.retailerSoldCount ?? 0);
    const available = row.active && sold < row.productCount;
    const description = row.description.trim().replace(/\s+/g, ' ').slice(0, 180);
    const message = [
      `📢 *${available ? 'PRODUCT AVAILABLE!' : 'PRODUCT OUT OF STOCK'}*`, '',
      `✨ *Product Name:* ${row.category || 'Product'}`, '',
      `📝 *Description:* ${description}`, '',
      `💰 *Price:* ${money(amount)}`, '',
      `📦 *Availability:* ${available ? 'In Stock' : 'Out of Stock'}`,
      `🚚 *Delivery:* ${available ? 'Available' : 'Not Available'}`, '',
      '📞 *For Orders:* DM US', '', '📸 Product image attached.', '', '*EllextStore*',
    ].join('\n');
    try {
      await shareProductWithImage({ image: row.image, filename: row.category || row.description, text: message });
      setNotice('Product image and retailer price are ready to share. Choose WhatsApp, then a chat or Status.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setNotice(error instanceof Error ? error.message : 'Could not share the product image and details.');
    }
  };
  const signOut = async () => { await fetchWithDataLoading('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  return <main className="page-shell"><div className="dashboard currency-dashboard retailers-dashboard">
    <aside className="sidebar currency-sidebar"><Link href="/" className="brand currency-brand"><BrandLogo /></Link><nav className="primary-nav" aria-label="Main navigation">
      <Link className="nav-link" href="/"><LayoutDashboard size={19}/><span>Dashboard</span></Link><Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19}/><span>Currency Exchange</span></Link><Link className="nav-link" href="/product-percentage"><Percent size={19}/><span>Product Percentage</span></Link><Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19}/><span>Selling Details</span></Link><Link className="nav-link selected" href="/ellext-retailers"><Store size={19}/><span>Retailers</span></Link><Link className="nav-link" href="/expense-ledger"><ReceiptText size={19}/><span>Expense Ledger</span></Link>
    </nav><div className="currency-sidebar-note"><span className="currency-rate-icon"><Store size={18}/></span><span>RETAILER SALES<br/><b>{totals.count.toLocaleString('en-IN')} items</b></span></div><button className="logout currency-logout" onClick={signOut}><LogOut size={17}/> Sign out</button></aside>
    <section className="main-panel currency-main retailers-main"><header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/ellext-retailers"/><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · RETAIL PARTNERS</span><h1>Retailers</h1><p>Set retailer pricing and track retailer sales separately.</p></div><Link href="/currency-exchange" className="currency-add"><ArrowLeftRight size={16}/> Currency exchange</Link></header>
      <section className="selling-summary retailers-summary"><article><span>RETAILER ITEMS SOLD</span><strong>{totals.count.toLocaleString('en-IN')}</strong><small>Tracked separately from direct sales</small></article><article><span>RETAILER COLLECTION</span><strong>{money(totals.collected)}</strong><small>Retailer amount × retailer sold count</small></article></section>
      <div className="currency-table-heading"><div><h2>Retailer product rows</h2><p>{rows.length} active product {rows.length === 1 ? 'row' : 'rows'} from Currency Exchange</p></div></div>
      {loading && !hasLoadedSharedData ? <div className="currency-empty"><strong>Loading shared retailer data…</strong></div> : loadError && rows.length === 0 ? <div className="currency-empty retailer-load-error" role="alert"><strong>Retailer data could not be loaded</strong><p>{loadError}</p><button className="currency-empty-link" onClick={() => setReload(value => value + 1)}>Try again</button></div> : rows.length ? <>{loadError && <div className="retailer-inline-error" role="status"><span>Previously loaded shared retailer data remains visible. Refresh failed: {loadError}</span><button onClick={() => setReload(value => value + 1)}>Retry</button></div>}<div className="currency-table-wrap retailer-desktop-table"><table className="currency-table retailer-table"><thead><tr><th>Date</th><th>Image</th><th>Description</th><th>Retailer amount</th><th>Product count</th><th>Retailer sold</th><th>Collected amount</th><th>Actions</th></tr></thead><tbody>{rows.map(row => {
        const entry = entryMap.get(row.id); const draft = drafts[row.id] ?? { amount: '', sold: '0' }; const sold = entry?.retailerSoldCount ?? 0; const amount = entry?.retailerAmountInr ?? 0; const collected = sold * amount; const available = Math.max(0, row.productCount - (entry?.soldCount ?? 0));
        const amountSaved = entry?.retailerAmountInr !== undefined; const soldSaved = entry?.retailerSoldCount !== undefined; const amountEditing = editingAmount.includes(row.id) || !amountSaved; const soldEditing = editingSold.includes(row.id) || !soldSaved;
        return <tr key={row.id}><td className="currency-date">{new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(row.date))}</td><td><button className="currency-image-button" onClick={() => setPreview(row)} aria-label={`Preview ${row.category || row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized /></button></td><td className="currency-description" title={row.description}><span>{row.description}</span><small>{row.category || 'Product'}</small></td><td><div className="retailer-field-editor"><label className="visually-hidden" htmlFor={`retail-amount-${row.id}`}>Retailer amount in INR for {row.description}</label><input className="retailer-input" id={`retail-amount-${row.id}`} type="number" min="0.01" step="0.01" value={draft.amount} disabled={!amountEditing} onChange={event => setDrafts(current => ({...current,[row.id]:{...draft,sold:draft.sold,amount:event.target.value}}))} placeholder="0.00" /><button onClick={() => amountEditing ? void saveRetailerField(row,'amount') : toggleRetailerEdit(row,'amount')} disabled={savingId === `${row.id}:amount`} aria-label={`${amountEditing?'Save and lock':'Unlock'} retailer amount for ${row.description}`} title={amountEditing?'Save and lock amount':'Unlock amount to edit'}>{savingId === `${row.id}:amount` ? '…' : amountEditing ? <Check size={14}/> : <UnlockKeyhole size={14}/>}</button></div>{errors[`${row.id}:amount`]&&<small className="retailer-error" role="alert">{errors[`${row.id}:amount`]}</small>}</td><td>{row.productCount.toLocaleString('en-IN')}</td><td><div className="retailer-field-editor"><label className="visually-hidden" htmlFor={`retail-sold-${row.id}`}>Retailer sold item count for {row.description}</label><input className="retailer-input retailer-count-input" id={`retail-sold-${row.id}`} type="number" min="0" max={available} step="1" value={draft.sold} disabled={!soldEditing} onChange={event => setDrafts(current => ({...current,[row.id]:{...draft,amount:draft.amount,sold:event.target.value}}))} placeholder="0" /><button onClick={() => soldEditing ? void saveRetailerField(row,'sold') : toggleRetailerEdit(row,'sold')} disabled={savingId === `${row.id}:sold`} aria-label={`${soldEditing?'Save and lock':'Unlock'} retailer sold count for ${row.description}`} title={soldEditing?'Save and lock sold count':'Unlock sold count to edit'}>{savingId === `${row.id}:sold` ? '…' : soldEditing ? <Check size={14}/> : <UnlockKeyhole size={14}/>}</button></div>{errors[`${row.id}:sold`]&&<small className="retailer-error" role="alert">{errors[`${row.id}:sold`]}</small>}</td><td className="currency-money">{amount ? money(collected) : '—'}</td><td><button className="share-row" onClick={() => void shareRetailerProduct(row)} aria-label={`Share ${row.description} with retailer price`} title="Share image and details"><Share2 size={15}/></button></td></tr>;
      })}</tbody></table></div>
      <div className="retailer-mobile-list">{rows.map(row => { const entry=entryMap.get(row.id); const draft=drafts[row.id]??{amount:'',sold:'0'}; const amount=entry?.retailerAmountInr??0; const sold=entry?.retailerSoldCount??0; const available=Math.max(0,row.productCount-(entry?.soldCount??0)); return <article className="selling-mobile-card" key={row.id}><div className="selling-mobile-head"><button className="currency-image-button" onClick={()=>setPreview(row)} aria-label={`Preview ${row.category||row.description}`}><Image src={row.image} alt={row.description} fill sizes="64px" unoptimized/></button><div><span>{row.category||'Product'} · {row.productCount} total</span><b>{row.description}</b></div></div><div className="selling-mobile-values retailer-mobile-values"><div><span>Retailer amount</span><input className="retailer-input" type="number" min="0.01" step="0.01" aria-label={`Retailer amount for ${row.description}`} value={draft.amount} onChange={event=>setDrafts(current=>({...current,[row.id]:{...draft,amount:event.target.value}}))} placeholder="0.00"/></div><div><span>Retailer sold (max {available})</span><input className="retailer-input" type="number" min="0" max={available} step="1" aria-label={`Retailer sold count for ${row.description}`} value={draft.sold} onChange={event=>setDrafts(current=>({...current,[row.id]:{...draft,sold:event.target.value}}))}/></div><div><span>Collected amount</span><b>{amount?money(amount*sold):'—'}</b></div><div className="retailer-mobile-actions"><button className="increase-save" onClick={()=>void saveRetailer(row)} disabled={savingId===row.id}>{savingId===row.id?'Saving…':'Save retailer details'}</button><button className="share-row" onClick={()=>void shareRetailerProduct(row)} aria-label={`Share ${row.description} with retailer price`} title="Share image and details"><Share2 size={15}/></button></div></div>{errors[row.id]&&<small className="retailer-error" role="alert">{errors[row.id]}</small>}</article>;})}</div></> : <div className="currency-empty"><span className="currency-empty-icon"><ImageIcon size={20}/></span><strong>No active products yet</strong><p>Add product rows in Currency Exchange to set retailer amounts.</p><Link href="/currency-exchange" className="currency-empty-link"><ArrowLeftRight size={15}/> Open Currency Exchange</Link></div>}
      <footer className="currency-source"><span className="rate-dot"/>Retailer prices and sales are tracked separately from direct sales and included in Super Admin Company Growth.</footer>
    </section></div>
    {preview&&<div className="modal-scrim image-preview-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setPreview(null);}}><section className="image-preview-card" role="dialog" aria-modal="true" aria-label={`${preview.description} image preview`}><button className="modal-close image-preview-close" onClick={()=>setPreview(null)} aria-label="Close image preview"><span aria-hidden>×</span></button><Image src={preview.image} alt={preview.description} fill sizes="(max-width: 700px) 90vw, 640px" unoptimized/><p>{preview.description}</p></section></div>}
    {notice&&<div className="toast" role="status"><Check size={16}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
  </main>;
}
