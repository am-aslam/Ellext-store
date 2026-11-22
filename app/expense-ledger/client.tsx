'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeftRight, ChartNoAxesColumnIncreasing, Check, LayoutDashboard, LogOut, Percent, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { isStoredExpenseLedger, readVersioned, storageKeys, writeVersioned, type ExpenseLedgerEntry } from '@/lib/storage';
import { MobileFinanceNav } from '@/components/mobile-finance-nav';

const categories = ['Shipping', 'Packaging', 'Marketing', 'Rent', 'Utilities', 'Staff', 'Other'];
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);

export default function ExpenseLedgerClient({ userName }: { userName: string }) {
  const [entries, setEntries] = useState<ExpenseLedgerEntry[]>([]);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const cached = readVersioned(storageKeys.expenseLedger, isStoredExpenseLedger) ?? [];
    const cachedIds = new Set(cached.map(entry => entry.id));
    setEntries(cached);
    setHydrated(true);
    fetch('/api/expense-ledger', { cache: 'no-store' }).then(async response => {
      const result = await response.json().catch(() => ({})) as { entries?: ExpenseLedgerEntry[]; error?: string };
      if (!response.ok) throw new Error(result.error || `Expense service unavailable (${response.status}).`);
      if (Array.isArray(result.entries) && isStoredExpenseLedger(result.entries)) {
        const serverEntries = result.entries;
        const pending = cached.filter(entry => entry.localOnly);
        const synced = await Promise.all(pending.map(async entry => {
          try {
            const save = await fetch('/api/expense-ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry), signal: AbortSignal.timeout(5000) });
            if (!save.ok) return entry;
            const saved = await save.json() as { entry?: ExpenseLedgerEntry };
            return saved.entry ?? entry;
          } catch { return entry; }
        }));
        setEntries(current => {
          // Keep entries submitted while the initial server read was in flight.
          const submittedDuringLoad = current.filter(entry => !cachedIds.has(entry.id));
          const merged = new Map<string, ExpenseLedgerEntry>();
          [...synced, ...serverEntries, ...submittedDuringLoad].forEach(entry => merged.set(entry.id, entry));
          return Array.from(merged.values()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        });
      }
    }).catch(() => setNotice(cached.length
      ? 'Showing saved browser data; shared expense storage is unavailable.'
      : 'Expense storage is unavailable. Entries can be saved on this device and will sync when storage is restored.'));
  }, []);
  useEffect(() => { if (hydrated) writeVersioned(storageKeys.expenseLedger, entries); }, [hydrated, entries]);
  const total = useMemo(() => entries.reduce((sum, entry) => sum + entry.amount, 0), [entries]);
  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError('Enter an expense amount greater than zero.'); return; }
    if (note.trim().length < 2) { setError('Add a short note describing the expense.'); return; }
    const id = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const draft: ExpenseLedgerEntry = { id, amount: value, category, note: note.trim(), date: new Date().toISOString(), createdBy: userName, localOnly: true };
    setEntries(current => [draft, ...current]);
    setAmount(''); setNote(''); setError('');
    setNotice('Expense saved on this device. Syncing to shared storage…');
    setSaving(true);
    try {
      const response = await fetch('/api/expense-ledger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft), signal: AbortSignal.timeout(5000) });
      const result = await response.json() as { entry?: ExpenseLedgerEntry; error?: string };
      if (!response.ok || !result.entry) throw new Error(result.error || 'Unable to save expense.');
      setEntries(current => [result.entry!, ...current.filter(entry => entry.id !== id && entry.id !== result.entry!.id)]);
      setNotice('Expense recorded and included in Company Growth.');
    } catch (cause) {
      setNotice(cause instanceof Error ? `${cause.message} Saved on this device and will sync when available.` : 'Shared storage unavailable. Saved on this device and will sync when available.');
    } finally {
      setSaving(false);
    }
  };
  const removeEntry = async (id: string) => {
    const target = entries.find(entry => entry.id === id);
    if (target?.localOnly) {
      setEntries(current => current.filter(entry => entry.id !== id));
      setNotice('Saved expense removed from this device.');
      return;
    }
    try {
      const response = await fetch('/api/expense-ledger', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || `Unable to remove expense (${response.status}).`);
      setEntries(current => current.filter(entry => entry.id !== id)); setNotice('Expense removed from the ledger.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to remove expense.'); }
  };
  const signOut = async () => { await fetch('/api/auth/sign-out', { method: 'POST' }); window.location.assign('/sign-in'); };

  return <main className="page-shell"><div className="dashboard currency-dashboard expense-dashboard">
    <aside className="sidebar currency-sidebar"><Link href="/" className="brand currency-brand"><BrandLogo /></Link><nav className="primary-nav" aria-label="Main navigation"><Link className="nav-link" href="/"><LayoutDashboard size={19}/><span>Dashboard</span></Link><Link className="nav-link" href="/currency-exchange"><ArrowLeftRight size={19}/><span>Currency Exchange</span></Link><Link className="nav-link" href="/product-percentage"><Percent size={19}/><span>Product Percentage</span></Link><Link className="nav-link" href="/selling-details"><ChartNoAxesColumnIncreasing size={19}/><span>Selling Details</span></Link><Link className="nav-link selected" href="/expense-ledger"><ReceiptText size={19}/><span>Expense Ledger</span></Link></nav><div className="currency-sidebar-note"><span className="currency-rate-icon"><ReceiptText size={18}/></span><span>RECORDED COSTS<br/><b>{money(total)}</b></span></div><button className="logout currency-logout" onClick={signOut}><LogOut size={17}/> Sign out</button></aside>
    <section className="main-panel currency-main expense-main"><header className="currency-header"><div><div className="finance-mobile-topline"><MobileFinanceNav active="/expense-ledger"/><Link href="/" className="currency-mobile-home"><BrandLogo /></Link></div><span className="currency-kicker">ELLEXTSTORE · OPERATIONS</span><h1>Expense Ledger</h1><p>Record operating costs. Entries are included automatically in the Super Admin Company Growth report.</p></div></header>
      <section className="expense-overview"><div><span className="currency-kicker">TOTAL RECORDED</span><strong>{money(total)}</strong><small>{entries.length} expense {entries.length === 1 ? 'entry' : 'entries'} · Added by {userName}</small></div><div className="expense-overview-icon"><ReceiptText size={22}/></div></section>
      <div className="expense-layout"><section className="growth-panel"><div className="growth-panel-title"><div><span className="currency-kicker">NEW ENTRY</span><h2>Add an operating expense</h2></div></div><form className="expense-entry-form" onSubmit={addEntry}><label>Expense amount (INR)<input required type="number" min="0.01" step="0.01" value={amount} onChange={event => {setAmount(event.target.value);setError('');}} placeholder="0.00"/></label><label>Expense category<select required value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select></label><label>Expense note<textarea required minLength={2} maxLength={500} value={note} onChange={event => {setNote(event.target.value);setError('');}} placeholder="Describe the cost, vendor, or purpose" rows={3}/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="form-submit" type="submit" disabled={saving}><Plus size={16}/>{saving ? 'Saving…' : 'Record expense'}</button></form></section>
        <section className="growth-panel expense-history"><div className="growth-panel-title"><div><span className="currency-kicker">AUDIT TRAIL</span><h2>Expense entries</h2></div><b>{entries.length}</b></div>{entries.length ? <ul className="expense-ledger-list">{entries.map(entry => <li key={entry.id}><span className="expense-category-icon"><ReceiptText size={16}/></span><div className="expense-ledger-description"><b>{entry.note}</b><small>{entry.category} · {new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(entry.date))}</small></div><strong>{money(entry.amount)}</strong><button className="expense-delete" onClick={() => removeEntry(entry.id)} aria-label={`Remove ${entry.note} expense`} title="Remove expense"><Trash2 size={15}/></button></li>)}</ul> : <div className="currency-empty expense-empty"><span className="currency-empty-icon"><ReceiptText size={20}/></span><strong>No expenses recorded yet</strong><p>Entries added here will flow into net profit and net margin automatically.</p></div>}</section></div>
    </section>
  </div>{notice && <div className="toast" role="status"><Check size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}</main>;
}
